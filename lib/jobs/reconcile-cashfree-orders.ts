import crypto from 'node:crypto'
import { and, asc, eq, gte, lt, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments } from '@/lib/db/schema'
import { CASHFREE_PROVIDER, checkOrderPayments } from '@/lib/payments/cashfree-adapter'
import { processNormalizedPaymentEvent } from '@/lib/payments/webhook'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { JobResult, ScheduledJob } from './types'

/**
 * Polls Cashfree's `GET /orders/{id}/payments` for `cashfree` payments stuck
 * in `PENDING` past `RECONCILE_MIN_AGE_MS` — the safety net for an order
 * whose webhook never arrives — AND, within a bounded grace window, payments
 * already marked `FAILED` (a student who sees `failed` reported once but then
 * successfully retries on Cashfree's still-open hosted page for the SAME
 * order_id must still be caught). A late `success` for an already-`FAILED`
 * row is not a new mechanism — `lib/payments/webhook.ts#applyEvent` already
 * handles a `payment.captured` event for a payment whose registration is no
 * longer `PAYMENT_PENDING` via the existing `PAYMENT_AFTER_HOLD_EXPIRED`
 * exception path.
 *
 * Cashfree webhooks carry a real cryptographic signature
 * (lib/payments/cashfree-adapter.ts), so this job is purely a missed-
 * delivery safety net, not the primary trust mechanism.
 *
 * `RECONCILE_MIN_AGE_MS`: 3 minutes — comfortably inside the 5-minute cron
 * cadence and the 15-minute reservation TTL, while giving a normal webhook
 * delivery time to arrive first so the job isn't racing every single
 * payment.
 */
export const RECONCILE_MIN_AGE_MS = 3 * 60 * 1000

/**
 * How long after being marked `FAILED` a cashfree payment is still worth a
 * late-retry poll. Bounded rather than indefinite: Cashfree's own hosted page
 * doesn't stay open forever, and this job runs every 5 minutes, so a retry-
 * success arriving more than an hour after the failure is vanishingly
 * unlikely to still be reachable — an admin resolving a stray late payment
 * manually (the existing exception-queue path) is an acceptable outcome past
 * that point, not a silent loss.
 */
export const RECONCILE_FAILED_GRACE_MS = 60 * 60 * 1000

/** Bounded per run so one job run stays fast under the 5-minute cron. */
export const RECONCILE_BATCH_SIZE = 50

/** Bounded concurrency for the batch's get-payments calls (avoid serializing into a multi-minute run). */
export const RECONCILE_CONCURRENCY = 8

/** Overall wall-clock budget for one job run, comfortably inside the 5-minute cron cadence. */
export const RECONCILE_RUN_DEADLINE_MS = 4 * 60 * 1000

/**
 * Builds a fresh Cashfree config for this run only (never cached at module
 * scope — Workers request-scoping rule, same as
 * lib/payments/registry.ts#getPaymentsAdapter). Returns null when
 * CASHFREE_CLIENT_ID/CASHFREE_CLIENT_SECRET aren't configured — the job is
 * then a deliberate no-op (there is nothing to poll with, and no cashfree
 * payment could exist without the adapter having been usable when it was
 * created).
 */
function cashfreeConfig(): { clientId: string; clientSecret: string; env: 'sandbox' | 'production' } | null {
  const clientId = getRuntimeEnv('CASHFREE_CLIENT_ID')
  const clientSecret = getRuntimeEnv('CASHFREE_CLIENT_SECRET')
  if (!clientId || !clientSecret) return null
  const env = getRuntimeEnv('CASHFREE_ENV') === 'sandbox' ? 'sandbox' : 'production'
  return { clientId, clientSecret, env }
}

/** Splits `items` into consecutive chunks of at most `size` — bounded concurrency without a dependency. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export const reconcileCashfreeOrdersJob: ScheduledJob = {
  name: 'reconcileCashfreeOrders',
  async run({ now }): Promise<JobResult> {
    const config = cashfreeConfig()
    if (!config) {
      return { notConfigured: true }
    }

    // Wall-clock budget for the run itself — deliberately NOT derived from
    // the logical `now` (which can be an arbitrary business-date, e.g. in
    // tests), since this deadline exists to bound the ACTUAL time this run
    // takes against the real 5-minute cron cadence, not to compare against
    // `now`.
    const runDeadline = Date.now() + RECONCILE_RUN_DEADLINE_MS
    const cutoff = new Date(now.getTime() - RECONCILE_MIN_AGE_MS)
    const failedGraceCutoff = new Date(now.getTime() - RECONCILE_FAILED_GRACE_MS)
    const stale = await db
      .select({ id: payments.id, providerOrderId: payments.providerOrderId, createdAt: payments.createdAt })
      .from(payments)
      .where(
        and(
          eq(payments.provider, CASHFREE_PROVIDER),
          or(
            and(eq(payments.status, 'PENDING'), lt(payments.createdAt, cutoff)),
            // Late-retry-success grace window: a FAILED payment is worth one
            // more get-payments call for a bounded window, in case Cashfree
            // reports success for the same order_id after a student's retry
            // on their still-open hosted page. Keyed on updatedAt (when it
            // was marked FAILED), not createdAt, so the window starts from
            // the failure itself.
            and(eq(payments.status, 'FAILED'), gte(payments.updatedAt, failedGraceCutoff)),
          ),
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(RECONCILE_BATCH_SIZE)

    let resolved = 0
    let stillPending = 0
    // Distinct from stillPending: a get-payments call that errors
    // (network/timeout/malformed response) is NOT the same signal as an
    // authentic "no decisive attempt yet" result — a total Cashfree outage
    // must be visible in the job's own summary/logs rather than reading
    // identically to normal pending-payment volume.
    let failed = 0

    for (const batch of chunk(stale, RECONCILE_CONCURRENCY)) {
      if (Date.now() >= runDeadline) break
      const outcomes = await Promise.allSettled(
        batch.map(async (row) => {
          const event = await checkOrderPayments(row.providerOrderId, config)
          return { row, event }
        }),
      )

      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          // Same "leave it unprocessed, try again next run" contract as a
          // failed webhook delivery — never marks anything resolved on a
          // get-payments failure.
          console.error('[payments] reconcileCashfreeOrders: get-payments failed', outcome.reason)
          failed += 1
          continue
        }

        const { row, event } = outcome.value
        if (!event) {
          // Authentically still pending at Cashfree — nothing to change yet.
          stillPending += 1
          continue
        }

        const payloadSha256 = crypto.createHash('sha256').update(`reconcile:${event.eventId}`).digest('hex')
        const result = await processNormalizedPaymentEvent(CASHFREE_PROVIDER, event, payloadSha256, now)
        if (result.ok) {
          resolved += 1
        } else {
          // A payment resolved by a concurrent webhook mid-run, or an event
          // that no longer matches anything, is not a job failure — the same
          // dedupe/row-lock guarantee that protects two concurrent webhooks
          // protects a webhook racing this job.
          console.warn(`[payments] reconcileCashfreeOrders: order ${row.providerOrderId} did not resolve (${result.error})`)
          stillPending += 1
        }
      }

      if (Date.now() >= runDeadline) break
    }

    // Orders never reached because the run deadline hit mid-batch are simply
    // picked up next run — not counted as failed or resolved.
    return { polled: stale.length, resolved, stillPending, failed }
  },
}
