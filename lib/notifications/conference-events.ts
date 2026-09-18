import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrations, users, verificationLogs } from '@/lib/db/schema'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

interface Recipient {
  email: string
  name: string
  /** False for a delegate whose registration was PENDING/PAYMENT_PENDING and got swept to CANCELLED by this same action — never had a confirmed spot to lose. */
  wasConfirmed: boolean
}

/**
 * Who made the call, as far as the email is concerned. Only an organizer's own
 * reason is quoted: their settings page tells them it may be shared with
 * delegates. A staff member's reason is an internal audit note (the admin
 * cancel dialog says so) and can hold findings such as suspected fraud, so it
 * is never emailed, to delegates or to the organizer.
 */
type Cancellation = { by: 'ORGANIZER'; reason: string | null } | { by: 'STAFF' } | { by: 'UNKNOWN' }

function buildBody(recipientName: string, munName: string, cancellation: Cancellation, wasConfirmed: boolean): string {
  const appUrl = getRuntimeEnv('APP_URL') ?? 'http://localhost:3000'
  let detail = ''
  if (cancellation.by === 'ORGANIZER' && cancellation.reason) {
    detail = ` The organizer gave this reason: ${cancellation.reason}.`
  } else if (cancellation.by === 'STAFF') {
    detail = ' The MUN Hub team made this decision.'
  }

  // Honest about what actually happened to this recipient's money/spot: a
  // confirmed (paid) registration is subject to the no-refunds policy, but a
  // registration that was still PENDING/PAYMENT_PENDING was never confirmed
  // in the first place, so there's no payment or spot to talk about.
  const outcome = wasConfirmed
    ? `Payments for this conference are final — see ${appUrl}/legal/refunds for our policy.`
    : `Your registration hadn't been confirmed yet, so there's nothing further you need to do.`

  return (
    `Hi ${recipientName},\n\n` +
    `We're sorry to let you know that "${munName}" has been cancelled.${detail}\n\n` +
    `${outcome}\n\n` +
    `If you have questions, our support team is happy to help.`
  )
}

export interface NotifyConferenceCancelledOptions {
  adapter?: NotificationsAdapter
  /**
   * Registration ids that THIS SAME cancellation flipped PENDING/
   * PAYMENT_PENDING -> CANCELLED (registration-lifecycle.ts's
   * `applyPlan`, via `IN_FLIGHT_REGISTRATION_STATUSES`) — passed through
   * explicitly rather than re-derived here so there's no ambiguity with a
   * registration that was already cancelled for an unrelated reason before
   * this action ever ran. These delegates get a distinct, honest email:
   * their registration was never confirmed, so there's no payment/spot to
   * talk about (docs/review-to-claude.md item #12 — before this, they got
   * no email at all).
   */
  justCancelledRegistrationIds?: string[]
}

/**
 * "${munName} has been cancelled" — every delegate holding a CONFIRMED
 * registration, every delegate whose PENDING/PAYMENT_PENDING registration
 * this same cancellation just swept to CANCELLED, plus the organizer when an
 * admin (not the organizer themselves) made the call. No refunds in this
 * product — a CONFIRMED recipient's copy states "payments are final" and
 * links to /legal/refunds, nothing more, per this task's explicit
 * instruction not to promise or even imply one; a never-confirmed
 * recipient's copy says so instead, since there was nothing to refund.
 *
 * The cancellation reason lives on the latest `verification_logs` row for
 * this mun with `action = 'CANCELLED'` (lib/lifecycle/lifecycle-events.ts's
 * own docstring names this exact source) — `runLifecycleAction`
 * (registration-lifecycle.ts) writes that row in the same transaction as
 * the CANCELLED status transition, before this function ever runs (it's
 * only ever called after that transaction commits). The reason is quoted
 * only when the organizer wrote it (see `Cancellation`).
 */
export async function notifyConferenceCancelled(
  munId: string,
  options: NotifyConferenceCancelledOptions = {},
): Promise<void> {
  const { adapter = getNotificationsAdapter(), justCancelledRegistrationIds = [] } = options
  const [mun] = await db.select({ name: muns.name, organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')

  const [log] = await db
    .select({ reason: verificationLogs.notes, reviewerId: verificationLogs.reviewerId })
    .from(verificationLogs)
    .where(and(eq(verificationLogs.munId, munId), eq(verificationLogs.action, 'CANCELLED')))
    .orderBy(desc(verificationLogs.createdAt))
    .limit(1)

  const cancellation: Cancellation = !log
    ? { by: 'UNKNOWN' }
    : log.reviewerId === mun.organizerId
      ? { by: 'ORGANIZER', reason: log.reason?.trim() || null }
      : { by: 'STAFF' }

  const confirmedDelegates = await db
    .select({ email: users.email, name: users.name })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .where(and(eq(registrations.munId, munId), eq(registrations.status, 'CONFIRMED')))

  const justCancelledDelegates = justCancelledRegistrationIds.length
    ? await db
        .select({ email: users.email, name: users.name })
        .from(registrations)
        .innerJoin(users, eq(registrations.userId, users.id))
        .where(inArray(registrations.id, justCancelledRegistrationIds))
    : []

  const recipients: Recipient[] = [
    ...confirmedDelegates.map((d) => ({ ...d, wasConfirmed: true })),
    ...justCancelledDelegates.map((d) => ({ ...d, wasConfirmed: false })),
  ]

  // Notify the organizer too, but only when someone OTHER than the
  // organizer cancelled it (an admin/ops action) — the organizer already
  // knows if they did it themselves. The log row can be missing in theory (a
  // CANCELLED transition reached some other way than runLifecycleAction),
  // in which case there's no reviewer to compare against ('UNKNOWN') and the
  // organizer is skipped rather than guessed at.
  if (cancellation.by === 'STAFF') {
    const [organizer] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, mun.organizerId)).limit(1)
    if (organizer) recipients.push({ ...organizer, wasConfirmed: true })
  }

  await Promise.all(
    recipients.map(async (recipient) => {
      try {
        await adapter.send({
          to: recipient.email,
          subject: `${mun.name} has been cancelled`,
          body: buildBody(recipient.name, mun.name, cancellation, recipient.wasConfirmed),
        })
      } catch (error) {
        console.error('[conference-cancelled] delivery failed', { munId, to: recipient.email, error })
      }
    }),
  )
}
