import crypto from 'node:crypto'
import { and, asc, eq, gte, lt, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments } from '@/lib/db/schema'
import { GURUPAY_PROVIDER, checkOrderStatus } from '@/lib/payments/gurupay-adapter'
import { processNormalizedPaymentEvent } from '@/lib/payments/webhook'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { JobResult, ScheduledJob } from './types'

/**
 * Polls GuruPay's `check-status` for `gurupay` payments stuck in `PENDING`
 * past `RECONCILE_MIN_AGE_MS` — the safety net for an order whose webhook
 * never arrives (docs/payments/SPEC.md §4.4.2, §4.5, §6) — AND, within a
 * bounded grace window, payments already marked `FAILED` (bug fix: a student
 * who sees `failed` reported once but then successfully retries on GuruPay's
 * still-open hosted page for the SAME order_id must still be caught, not
 * silently unreachable forever). A late `success` for an already-`FAILED`
 * row is not a new mechanism — `lib/payments/webhook.ts#applyEvent` already
 * handles a `payment.captured` event for a payment whose registration is no
 * longer `PAYMENT_PENDING` via the existing `PAYMENT_AFTER_HOLD_EXPIRED`
 * exception path (money arrived, seat is gone, an admin resolves it) — this
 * job only needs to make sure that check-status call actually happens.
 *
 * `RECONCILE_MIN_AGE_MS` (docs/payments/SPEC.md §11 Q6, implementer default,
 * not user-confirmed): 3 minutes — comfortably inside the 5-minute cron
 * cadence and the 15-minute reservation TTL, while giving a normal webhook
 * delivery time to arrive first so the job isn't racing every single
 * payment.
 */
export const RECONCILE_MIN_AGE_MS = 3 * 60 * 1000

/**
 * How long after being marked `FAILED` a gurupay payment is still worth a
 * late-retry check-status poll. Bounded rather than indefinite: GuruPay's own
 * hosted page doesn't stay open forever, and this job runs every 5 minutes,
 * so a retry-success arriving more than an hour after the failure is
 * vanishingly unlikely to still be reachable — an admin resolving a stray
 * late payment manually (the existing exception-queue path) is an acceptable
 * outcome past that point, not a silent loss.
 */
export const RECONCILE_FAILED_GRACE_MS = 60 * 60 * 1000

/** Bounded per run so one job run stays fast under the 5-minute cron (§4.4.2). */
export const RECONCILE_BATCH_SIZE = 50

/** Bounded concurrency for the batch's check-status calls (§4.4.2/bug fix — avoid serializing into a multi-minute run). */
export const RECONCILE_CONCURRENCY = 8

/** Overall wall-clock budget for one job run, comfortably inside the 5-minute cron cadence. */
export const RECONCILE_RUN_DEADLINE_MS = 4 * 60 * 1000

/**
 * Builds a fresh GuruPay adapter config for this run only (never cached at
 * module scope — Workers request-scoping rule, same as
 * lib/payments/registry.ts#getPaymentsAdapter). Returns null when
 * GURUPAY_API_KEY isn't configured — the job is then a deliberate no-op
 * (there is nothing to poll with, and no gurupay payment could exist without
 * the adapter having been usable when it was created).
 */
function guruPayConfig(): { apiKey: string } | null {
  const apiKey = getRuntimeEnv('GURUPAY_API_KEY')
  return apiKey ? { apiKey } : null
}

/** Splits `items` into consecutive chunks of at most `size` — bounded concurrency without a dependency. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export const reconcileGuruPayOrdersJob: ScheduledJob = {
  name: 'reconcileGuruPayOrders',
  async run({ now }): Promise<JobResult> {
    const config = guruPayConfig()
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
          eq(payments.provider, GURUPAY_PROVIDER),
          or(
            and(eq(payments.status, 'PENDING'), lt(payments.createdAt, cutoff)),
            // Late-retry-success grace window (bug fix, see file header): a
            // FAILED payment is worth one more check-status call for a
            // bounded window, in case GuruPay reports success for the same
            // order_id after a student's retry on their still-open hosted
            // page. Keyed on updatedAt (when it was marked FAILED), not
            // createdAt, so the window starts from the failure itself.
            and(eq(payments.status, 'FAILED'), gte(payments.updatedAt, failedGraceCutoff)),
          ),
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(RECONCILE_BATCH_SIZE)

    let resolved = 0
    let stillPending = 0
    // Distinct from stillPending (docs/payments/SPEC.md bug fix): a
    // check-status call that errors (network/timeout/malformed response) is
    // NOT the same signal as an authentic 'pending' status from GuruPay — a
    // total GuruPay outage must be visible in the job's own summary/logs
    // rather than reading identically to normal pending-payment volume.
    let failed = 0

    for (const batch of chunk(stale, RECONCILE_CONCURRENCY)) {
      if (Date.now() >= runDeadline) break
      const outcomes = await Promise.allSettled(
        batch.map(async (row) => {
          const event = await checkOrderStatus(row.providerOrderId, config)
          return { row, event }
        }),
      )

      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          // Same "leave it unprocessed, try again next run" contract as a
          // failed webhook delivery (docs/payments/SPEC.md §4.4.1 step 3) —
          // never marks anything resolved on a check-status failure.
          console.error('[payments] reconcileGuruPayOrders: check-status failed', outcome.reason)
          failed += 1
          continue
        }

        const { row, event } = outcome.value
        if (!event) {
          // Authentically still pending at GuruPay — nothing to change yet.
          stillPending += 1
          continue
        }

        const payloadSha256 = crypto.createHash('sha256').update(`reconcile:${event.eventId}`).digest('hex')
        const result = await processNormalizedPaymentEvent(GURUPAY_PROVIDER, event, payloadSha256, now)
        if (result.ok) {
          resolved += 1
        } else {
          // A payment resolved by a concurrent webhook mid-run, or an event
          // that no longer matches anything, is not a job failure — the same
          // dedupe/row-lock guarantee that protects two concurrent webhooks
          // protects a webhook racing this job (docs/payments/SPEC.md §6).
          console.warn(`[payments] reconcileGuruPayOrders: order ${row.providerOrderId} did not resolve (${result.error})`)
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
