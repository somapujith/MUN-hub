import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrations, users, verificationLogs } from '@/lib/db/schema'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

interface Recipient {
  email: string
  name: string
}

/**
 * Who made the call, as far as the email is concerned. Only an organizer's own
 * reason is quoted: their settings page tells them it may be shared with
 * delegates. A staff member's reason is an internal audit note (the admin
 * cancel dialog says so) and can hold findings such as suspected fraud, so it
 * is never emailed, to delegates or to the organizer.
 */
type Cancellation = { by: 'ORGANIZER'; reason: string | null } | { by: 'STAFF' } | { by: 'UNKNOWN' }

function buildBody(recipientName: string, munName: string, cancellation: Cancellation): string {
  const appUrl = getRuntimeEnv('APP_URL') ?? 'http://localhost:3000'
  let detail = ''
  if (cancellation.by === 'ORGANIZER' && cancellation.reason) {
    detail = ` The organizer gave this reason: ${cancellation.reason}.`
  } else if (cancellation.by === 'STAFF') {
    detail = ' The MUN Hub team made this decision.'
  }

  return (
    `Hi ${recipientName},\n\n` +
    `We're sorry to let you know that "${munName}" has been cancelled.${detail}\n\n` +
    `Payments for this conference are final — see ${appUrl}/legal/refunds for our policy.\n\n` +
    `If you have questions, our support team is happy to help.`
  )
}

/**
 * "${munName} has been cancelled" — every delegate holding a CONFIRMED
 * registration, plus the organizer when an admin (not the organizer
 * themselves) made the call. No refunds in this product — the copy states
 * "payments are final" and links to /legal/refunds, nothing more, per this
 * task's explicit instruction not to promise or even imply one.
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
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
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

  const delegates: Recipient[] = await db
    .select({ email: users.email, name: users.name })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .where(and(eq(registrations.munId, munId), eq(registrations.status, 'CONFIRMED')))

  const recipients: Recipient[] = [...delegates]

  // Notify the organizer too, but only when someone OTHER than the
  // organizer cancelled it (an admin/ops action) — the organizer already
  // knows if they did it themselves. The log row can be missing in theory (a
  // CANCELLED transition reached some other way than runLifecycleAction),
  // in which case there's no reviewer to compare against ('UNKNOWN') and the
  // organizer is skipped rather than guessed at.
  if (cancellation.by === 'STAFF') {
    const [organizer] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, mun.organizerId)).limit(1)
    if (organizer) recipients.push(organizer)
  }

  await Promise.all(
    recipients.map(async (recipient) => {
      try {
        await adapter.send({
          to: recipient.email,
          subject: `${mun.name} has been cancelled`,
          body: buildBody(recipient.name, mun.name, cancellation),
        })
      } catch (error) {
        console.error('[conference-cancelled] delivery failed', { munId, to: recipient.email, error })
      }
    }),
  )
}
