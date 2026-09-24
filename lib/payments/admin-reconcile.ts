import crypto from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { paymentWebhookEvents, payments } from '@/lib/db/schema'
import type { PaymentStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { cashfreeConfig } from '@/lib/jobs/reconcile-cashfree-orders'
import { CASHFREE_PROVIDER, checkOrderPayments } from './cashfree-adapter'
import { processNormalizedPaymentEvent, type WebhookResponseBody } from './webhook'

/**
 * Admin-triggered, single-payment counterpart to
 * `lib/jobs/reconcile-cashfree-orders.ts`'s 5-minute cron sweep — for the one
 * case the cron can't help with: an admin looking at one specific stuck
 * payment (not yet a payment exception — see ./exceptions.ts) who wants to
 * poke it NOW instead of waiting for the next run.
 *
 * Deliberately reuses, never re-implements:
 * - `checkOrderPayments` (cashfree-adapter.ts) — the exact same Cashfree
 *   `GET /orders/{id}/payments` per-order check the job's loop body calls.
 * - `cashfreeConfig` (reconcile-cashfree-orders.ts, exported for this file) —
 *   the same minimal env-driven config builder, so this never drifts from
 *   the job's own notion of "is Cashfree configured".
 * - `processNormalizedPaymentEvent` (webhook.ts) — the ONE code path that
 *   ever settles a payment (signature-independent here because
 *   `checkOrderPayments` already produced a normalized, trusted event from a
 *   direct authenticated Cashfree API call, exactly as the job trusts it).
 *   This file never writes to `payments`/`registrations` directly.
 */

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export const PAYMENT_RECONCILE_ERRORS = {
  notFound: 'Payment not found',
  unsupportedProvider: 'Only Cashfree payments can be reconciled against the provider',
  alreadySettled: 'This payment has already settled (paid or refunded) — nothing to reconcile',
  notConfigured: 'Cashfree is not configured in this environment',
} as const

// Same statuses the cron job targets (PENDING, and a recently-FAILED late
// retry) plus CREATED (an order made but never polled at all) — PAID/REFUNDED
// are truly terminal for this provider (no refunds; see exceptions.ts) and
// have nothing left to reconcile.
const RECONCILABLE_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING', 'FAILED']

export type PaymentReconcileOutcome =
  | 'no_decisive_attempt'
  | 'confirmed'
  | 'duplicate'
  | 'ignored'
  | 'exception'
  | 'failed'
  | 'rejected'

const OUTCOME_MESSAGES: Record<PaymentReconcileOutcome, string> = {
  no_decisive_attempt: 'Cashfree has no decisive payment attempt for this order yet — still pending.',
  confirmed: 'Cashfree reported a successful payment. The registration is now confirmed.',
  duplicate: 'This capture was already applied to this payment — nothing changed.',
  ignored: 'Cashfree reported a failed attempt after this payment already succeeded — nothing to do.',
  exception: 'Cashfree reported a payment that needs manual review — see the payment exceptions queue.',
  failed: 'Cashfree confirmed this payment failed. Any held seat was released.',
  rejected: 'The reconciliation check could not be applied.',
}

/** Maps `processNormalizedPaymentEvent`'s response-body flags onto our outcome vocabulary. */
function summarizeOutcome(body: WebhookResponseBody): Exclude<PaymentReconcileOutcome, 'no_decisive_attempt' | 'rejected'> {
  if (body.confirmed) return 'confirmed'
  if (body.duplicate) return 'duplicate'
  if (body.ignored) return 'ignored'
  if (body.exception) return 'exception'
  // payment.failed's own body is plain `{ ok: true }` with no distinguishing
  // flag — the only branch left once the flags above are all false.
  return 'failed'
}

export interface ReconcilePaymentResult {
  paymentId: string
  providerOrderId: string
  statusBefore: PaymentStatus
  statusAfter: PaymentStatus
  outcome: PaymentReconcileOutcome
  message: string
}

/**
 * Runs one Cashfree `GET /orders/{id}/payments` check for a single payment
 * and applies whatever it finds through the real settlement path — the exact
 * per-order logic `reconcileCashfreeOrdersJob` runs for every stuck order it
 * finds on its own 5-minute sweep, triggered here for one payment, on demand.
 * OPERATIONS/ADMIN/SUPER_ADMIN. Always writes one `admin_actions` row
 * (`PAYMENT_RECONCILE_TRIGGERED`), regardless of outcome, so every manual
 * trigger is traceable even when Cashfree still has nothing decisive to
 * report.
 */
export async function reconcilePaymentAsAdmin(
  paymentId: string,
  session: Session | null,
): Promise<ReconcilePaymentResult> {
  requireRole(session, [...ADMIN_ROLES])

  const [payment] = await db
    .select({
      id: payments.id,
      provider: payments.provider,
      providerOrderId: payments.providerOrderId,
      status: payments.status,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1)

  if (!payment) throw new Error(PAYMENT_RECONCILE_ERRORS.notFound)
  if (payment.provider !== CASHFREE_PROVIDER) throw new Error(PAYMENT_RECONCILE_ERRORS.unsupportedProvider)
  if (!RECONCILABLE_STATUSES.includes(payment.status)) {
    throw new Error(PAYMENT_RECONCILE_ERRORS.alreadySettled)
  }

  const config = cashfreeConfig()
  if (!config) throw new Error(PAYMENT_RECONCILE_ERRORS.notConfigured)

  const event = await checkOrderPayments(payment.providerOrderId, config)

  let statusAfter: PaymentStatus = payment.status
  let outcome: PaymentReconcileOutcome = 'no_decisive_attempt'
  let message = OUTCOME_MESSAGES.no_decisive_attempt

  if (event) {
    // Same "reconcile:<eventId>" payloadSha256 scheme the cron job uses — a
    // real signature never existed for a polled get-payments result, so this
    // is diagnostic-only content, not a correctness input (dedupe is on the
    // (provider, eventId) unique index, not this hash).
    const payloadSha256 = crypto.createHash('sha256').update(`reconcile:${event.eventId}`).digest('hex')
    const result = await processNormalizedPaymentEvent(CASHFREE_PROVIDER, event, payloadSha256, new Date())

    if (result.ok) {
      outcome = summarizeOutcome(result.body)
      message = OUTCOME_MESSAGES[outcome]
    } else {
      outcome = 'rejected'
      message = result.message
    }

    const [refreshed] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId)).limit(1)
    statusAfter = refreshed?.status ?? payment.status
  }

  await recordAdminAction(db, session.userId, 'PAYMENT_RECONCILE_TRIGGERED', 'payment', paymentId, undefined, {
    providerOrderId: payment.providerOrderId,
    statusBefore: payment.status,
    statusAfter,
    outcome,
  })

  return {
    paymentId: payment.id,
    providerOrderId: payment.providerOrderId,
    statusBefore: payment.status,
    statusAfter,
    outcome,
    message,
  }
}

export interface PaymentTimelineEvent {
  id: string
  eventType: string | null
  outcome: string | null
  receivedAt: Date
  processedAt: Date | null
}

export interface PaymentTimeline {
  paymentId: string
  registrationId: string
  provider: string
  providerOrderId: string
  status: PaymentStatus
  events: PaymentTimelineEvent[]
}

/**
 * Read-only payment lifecycle view for admin: every `payment_webhook_events`
 * row for this payment's `(provider, providerOrderId)`, oldest first — same
 * table and columns `lib/actions/registration.ts`'s student-receipt query
 * reads (~line 1143), just the full ordered history instead of one `PAID`
 * lookup. Admin's only payment visibility before this was the exceptions
 * queue and the registration search's bare `payments.status` — neither shows
 * event history. OPERATIONS/ADMIN/SUPER_ADMIN.
 *
 * No PII-read audit entry: unlike `searchRegistrations`/
 * `listPaymentExceptions`, these rows carry no delegate name/email — only
 * provider event metadata (event type, outcome, timestamps).
 */
export async function getPaymentTimeline(paymentId: string, session: Session | null): Promise<PaymentTimeline> {
  requireRole(session, [...ADMIN_ROLES])

  const [payment] = await db
    .select({
      id: payments.id,
      registrationId: payments.registrationId,
      provider: payments.provider,
      providerOrderId: payments.providerOrderId,
      status: payments.status,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1)

  if (!payment) throw new Error(PAYMENT_RECONCILE_ERRORS.notFound)

  const events = await db
    .select({
      id: paymentWebhookEvents.id,
      eventType: paymentWebhookEvents.eventType,
      outcome: paymentWebhookEvents.outcome,
      receivedAt: paymentWebhookEvents.receivedAt,
      processedAt: paymentWebhookEvents.processedAt,
    })
    .from(paymentWebhookEvents)
    .where(
      and(
        eq(paymentWebhookEvents.provider, payment.provider),
        eq(paymentWebhookEvents.providerOrderId, payment.providerOrderId),
      ),
    )
    .orderBy(asc(paymentWebhookEvents.receivedAt))

  return {
    paymentId: payment.id,
    registrationId: payment.registrationId,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    status: payment.status,
    events,
  }
}
