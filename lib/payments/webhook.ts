import crypto from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { paymentWebhookEvents, payments, registrations } from '@/lib/db/schema'
import { WebhookVerificationError, type PaymentWebhookEvent, type PaymentsAdapter } from './adapter'
import { onPaymentFailed, onRegistrationConfirmed, runPaymentHook } from './events'
import { PAYMENT_EXCEPTION_REASONS, type PaymentExceptionReason } from './exception-reasons'

/**
 * Provider webhook processing — the ONLY code path that settles a payment
 * (confirms a registration, fails a payment, or raises a payment exception).
 * `server/routes/webhooks.ts` feeds it real deliveries; the mock checkout
 * feeds it mock-signed ones through the exact same verification.
 *
 * Guarantees:
 * - Verification first: nothing is read or written for a delivery whose
 *   signature doesn't verify.
 * - Replay window: a delivery whose signed timestamp is more than
 *   `WEBHOOK_REPLAY_WINDOW_MS` from now is rejected (and logged).
 * - Dedupe: each (provider, eventId) is applied at most once. The event row
 *   is claimed inside the same transaction as the payment change, so a crash
 *   mid-processing rolls both back and the provider's retry is re-applied;
 *   a concurrent duplicate blocks on the claim and then sees it processed.
 * - Row locks: payment row, then registration row (`FOR UPDATE`), so two
 *   events for one order — or an event racing the seat-release sweep —
 *   serialize.
 * - Amount + currency must equal the payment row, else AMOUNT_MISMATCH.
 * - No refunds: money that arrives with no valid registration behind it is
 *   marked PAID with a payment exception for an admin to resolve.
 */

export const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type WebhookOutcome =
  | 'CONFIRMED'
  | 'DUPLICATE_CAPTURE'
  | 'FAILED'
  | 'IGNORED_FAILURE_AFTER_CAPTURE'
  | `EXCEPTION_${PaymentExceptionReason}`
  | 'UNKNOWN_ORDER'
  | 'REJECTED_STALE'

/** JSON body returned to the provider (and relayed by the mock checkout). */
export interface WebhookResponseBody {
  ok: true
  /** The event (or this exact capture) was already applied — nothing changed. */
  duplicate?: true
  /** Authentic, but not an event that changes anything. */
  ignored?: true
  /** The registration is now CONFIRMED. */
  confirmed?: true
  /** Money was taken without a valid registration behind it; an admin resolves it. */
  exception?: true
}

export type WebhookErrorCode = 'INVALID_SIGNATURE' | 'INVALID_PAYLOAD' | 'STALE_EVENT' | 'PAYMENT_NOT_FOUND'

export type ProcessWebhookResult =
  | {
      ok: true
      body: WebhookResponseBody
      /** Post-commit hooks (never rejects). Hand to `waitUntil` on Workers. */
      afterCommit: Promise<void>
    }
  | { ok: false; error: WebhookErrorCode; message: string }

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Inserts the event row, or re-claims one whose earlier delivery was never
 * processed (stale, unknown order, rolled back). Returns null when the event
 * was already processed — i.e. a duplicate.
 */
async function claimEvent(
  tx: Tx,
  provider: string,
  event: PaymentWebhookEvent,
  payloadSha256: string,
  now: Date,
): Promise<{ id: string } | null> {
  const [row] = await tx
    .insert(paymentWebhookEvents)
    .values({
      provider,
      eventId: event.eventId,
      eventType: event.providerEventType,
      providerOrderId: event.providerOrderId,
      payloadSha256,
      receivedAt: now,
    })
    .onConflictDoUpdate({
      target: [paymentWebhookEvents.provider, paymentWebhookEvents.eventId],
      set: { payloadSha256, receivedAt: now, outcome: null },
      setWhere: isNull(paymentWebhookEvents.processedAt),
    })
    .returning({ id: paymentWebhookEvents.id })
  return row ?? null
}

async function recordEventOutcome(
  tx: Tx,
  eventRowId: string,
  outcome: WebhookOutcome,
  processedAt: Date | null,
): Promise<void> {
  await tx
    .update(paymentWebhookEvents)
    .set({ outcome, processedAt })
    .where(eq(paymentWebhookEvents.id, eventRowId))
}

interface LockedPayment {
  id: string
  registrationId: string
  provider: string
  providerPaymentId: string | null
  amount: number
  currency: string
  status: (typeof payments.$inferSelect)['status']
  exceptionReason: string | null
  exceptionResolvedAt: Date | null
}

/** The charge an event reports, for log lines: which payment, for how much. */
function describeCharge(event: PaymentWebhookEvent): string {
  return `${event.providerPaymentId ?? 'unknown payment'} (${event.amount} ${event.currency})`
}

/**
 * Exception columns for a new exception. An exception that is still open is
 * never overwritten (the first reason stands until an admin resolves it);
 * a resolved one is replaced — the earlier resolution stays in admin_actions.
 *
 * KNOWN GAP (needs a migration): the payment row has no column for the
 * charge that raised the exception, so only these log lines name it. The
 * admin queue sends staff to the provider dashboard by order ID instead.
 */
function raiseException(
  payment: LockedPayment,
  reason: PaymentExceptionReason,
  event: PaymentWebhookEvent,
  now: Date,
) {
  const context =
    `payment ${payment.id} (order ${event.providerOrderId}, ${payment.amount} ${payment.currency}, ` +
    `payment on file ${payment.providerPaymentId ?? 'none'})`
  if (payment.exceptionReason !== null && payment.exceptionResolvedAt === null) {
    console.warn(
      `[payments] ${context} already has open exception ${payment.exceptionReason}; ` +
        `not recorded: ${reason} for charge ${describeCharge(event)}`,
    )
    return {}
  }
  console.warn(`[payments] ${context}: exception ${reason} for charge ${describeCharge(event)}`)
  return {
    exceptionReason: reason,
    exceptionRaisedAt: now,
    exceptionResolvedAt: null,
    exceptionResolvedBy: null,
    exceptionResolutionNote: null,
  }
}

type TxResult =
  | { kind: 'duplicate' }
  | { kind: 'not_found' }
  | { kind: 'done'; body: WebhookResponseBody; confirmedRegistrationId?: string; failedRegistrationId?: string }

async function applyEvent(
  tx: Tx,
  provider: string,
  event: PaymentWebhookEvent,
  eventRowId: string,
  now: Date,
): Promise<TxResult> {
  const [payment] = await tx
    .select({
      id: payments.id,
      registrationId: payments.registrationId,
      provider: payments.provider,
      providerPaymentId: payments.providerPaymentId,
      amount: payments.amount,
      currency: payments.currency,
      status: payments.status,
      exceptionReason: payments.exceptionReason,
      exceptionResolvedAt: payments.exceptionResolvedAt,
    })
    .from(payments)
    .where(eq(payments.providerOrderId, event.providerOrderId))
    .for('update')
    .limit(1)

  // A payment created by another provider is never settled by this one.
  // Left unprocessed (processedAt null) so a later retry is re-evaluated.
  if (!payment || payment.provider !== provider) {
    await recordEventOutcome(tx, eventRowId, 'UNKNOWN_ORDER', null)
    return { kind: 'not_found' }
  }

  const [registration] = await tx
    .select({ status: registrations.status })
    .from(registrations)
    .where(eq(registrations.id, payment.registrationId))
    .for('update')
    .limit(1)

  // LEGACY: before payment exceptions existed, a late payment was stored as
  // REFUNDED. Either way the money was captured.
  const alreadyCaptured = payment.status === 'PAID' || payment.status === 'REFUNDED'
  const finish = async (outcome: WebhookOutcome, body: WebhookResponseBody) => {
    await recordEventOutcome(tx, eventRowId, outcome, now)
    return body
  }

  if (event.type === 'payment.failed') {
    if (alreadyCaptured) {
      // A failed attempt reported after a successful one — nothing to undo.
      return { kind: 'done', body: await finish('IGNORED_FAILURE_AFTER_CAPTURE', { ok: true, ignored: true }) }
    }

    await tx
      .update(payments)
      .set({
        status: 'FAILED',
        providerPaymentId: payment.providerPaymentId ?? event.providerPaymentId,
        updatedAt: now,
      })
      .where(eq(payments.id, payment.id))

    const released = await tx
      .update(registrations)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(and(eq(registrations.id, payment.registrationId), eq(registrations.status, 'PAYMENT_PENDING')))
      .returning({ id: registrations.id })

    return {
      kind: 'done',
      body: await finish('FAILED', { ok: true }),
      failedRegistrationId: released.length > 0 ? payment.registrationId : undefined,
    }
  }

  // payment.captured
  if (alreadyCaptured) {
    const differentPayment =
      payment.providerPaymentId !== null &&
      event.providerPaymentId !== null &&
      payment.providerPaymentId !== event.providerPaymentId
    if (!differentPayment) {
      return { kind: 'done', body: await finish('DUPLICATE_CAPTURE', { ok: true, duplicate: true }) }
    }
    // A second, distinct charge against an order that is already paid. The
    // payment on file stays the first one (it may be what confirmed the seat).
    await tx
      .update(payments)
      .set({ ...raiseException(payment, PAYMENT_EXCEPTION_REASONS.duplicatePayment, event, now), updatedAt: now })
      .where(eq(payments.id, payment.id))
    return {
      kind: 'done',
      body: await finish(`EXCEPTION_${PAYMENT_EXCEPTION_REASONS.duplicatePayment}`, { ok: true, exception: true }),
    }
  }

  const amountMatches =
    event.amount === payment.amount && event.currency.toUpperCase() === payment.currency.toUpperCase()
  if (!amountMatches) {
    // Never confirm on an amount we didn't ask for. The registration keeps
    // its hold (and expires as usual); the admin reconciles the charge.
    await tx
      .update(payments)
      .set({
        ...raiseException(payment, PAYMENT_EXCEPTION_REASONS.amountMismatch, event, now),
        providerPaymentId: payment.providerPaymentId ?? event.providerPaymentId,
        updatedAt: now,
      })
      .where(eq(payments.id, payment.id))
    return {
      kind: 'done',
      body: await finish(`EXCEPTION_${PAYMENT_EXCEPTION_REASONS.amountMismatch}`, { ok: true, exception: true }),
    }
  }

  if (registration?.status === 'PAYMENT_PENDING') {
    await tx
      .update(payments)
      .set({ status: 'PAID', providerPaymentId: event.providerPaymentId, updatedAt: now })
      .where(eq(payments.id, payment.id))
    await tx
      .update(registrations)
      .set({ status: 'CONFIRMED', updatedAt: now })
      .where(eq(registrations.id, payment.registrationId))
    return {
      kind: 'done',
      body: await finish('CONFIRMED', { ok: true, confirmed: true }),
      confirmedRegistrationId: payment.registrationId,
    }
  }

  // The seat hold expired or was released before the money arrived. The
  // registration is never resurrected (its seat may be someone else's now);
  // the payment is recorded as PAID so the money is accounted for, and an
  // admin returns it. There is no refund state.
  await tx
    .update(payments)
    .set({
      status: 'PAID',
      providerPaymentId: event.providerPaymentId,
      ...raiseException(payment, PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired, event, now),
      updatedAt: now,
    })
    .where(eq(payments.id, payment.id))
  return {
    kind: 'done',
    body: await finish(`EXCEPTION_${PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired}`, {
      ok: true,
      exception: true,
    }),
  }
}

export async function processPaymentWebhook(
  adapter: PaymentsAdapter,
  rawBody: string,
  headers: Headers,
  now: Date = new Date(),
): Promise<ProcessWebhookResult> {
  let verified: PaymentWebhookEvent | null
  try {
    verified = await adapter.verifyAndParseWebhook(rawBody, headers)
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return { ok: false, error: error.reason, message: error.message }
    }
    throw error
  }

  if (!verified) {
    return { ok: true, body: { ok: true, ignored: true }, afterCommit: Promise.resolve() }
  }
  const event = verified

  const provider = adapter.provider
  const payloadSha256 = sha256(rawBody)

  if (event.signedAt && Math.abs(now.getTime() - event.signedAt.getTime()) > WEBHOOK_REPLAY_WINDOW_MS) {
    console.warn(`[payments] rejected stale webhook ${provider}/${event.eventId} signed at ${event.signedAt.toISOString()}`)
    await db.transaction(async (tx) => {
      const claimed = await claimEvent(tx, provider, event, payloadSha256, now)
      if (claimed) await recordEventOutcome(tx, claimed.id, 'REJECTED_STALE', null)
    })
    return { ok: false, error: 'STALE_EVENT', message: 'Webhook timestamp is outside the replay window' }
  }

  const result = await db.transaction(async (tx): Promise<TxResult> => {
    const claimed = await claimEvent(tx, provider, event, payloadSha256, now)
    if (!claimed) return { kind: 'duplicate' }
    return applyEvent(tx, provider, event, claimed.id, now)
  })

  if (result.kind === 'duplicate') {
    return { ok: true, body: { ok: true, duplicate: true }, afterCommit: Promise.resolve() }
  }
  if (result.kind === 'not_found') {
    return { ok: false, error: 'PAYMENT_NOT_FOUND', message: 'Payment not found' }
  }

  // Hooks run only now that the transaction has committed.
  const hooks: Promise<void>[] = []
  if (result.confirmedRegistrationId) {
    hooks.push(runPaymentHook(onRegistrationConfirmed, result.confirmedRegistrationId))
  }
  if (result.failedRegistrationId) {
    hooks.push(runPaymentHook(onPaymentFailed, result.failedRegistrationId))
  }
  return { ok: true, body: result.body, afterCommit: Promise.all(hooks).then(() => undefined) }
}
