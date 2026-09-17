import { and, eq, gt, lte } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrations, users } from '@/lib/db/schema'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { buildPublicMunUrl } from './resolve-recipients'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000 // 24 hours before the conference starts
const CRON_WINDOW_MS = 5 * 60 * 1000 // matches the assumed 5-minute cron cadence

function formatDateRange(startDate: Date, endDate: Date | null): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }
  const start = startDate.toLocaleDateString('en-IN', opts)
  if (!endDate || endDate.getTime() === startDate.getTime()) return start
  return `${start} – ${endDate.toLocaleDateString('en-IN', opts)}`
}

/**
 * Conference reminder emails — ~24h before a delegate's confirmed
 * registration's mun starts. Deliberately does NOT check
 * `emailNotificationsEnabled` (a judgment call, per this task's brief): this
 * is a time-critical operational notice about an event the delegate is
 * actually attending, the same category as a flight check-in reminder, not
 * a discretionary update like a welcome email or even the confirmation
 * receipt (missing this has real consequences — showing up unprepared or
 * not at all — where missing a welcome email has none). If that judgment
 * turns out wrong for this product, gate it the same way
 * registration-events.ts's functions do (`isEmailNotificationsEnabled`)
 * rather than silently changing behavior here.
 *
 * Idempotent for a 5-minute cron without a migration or a "sent" column:
 * each registration's reminder instant is the fixed point
 * `mun.startDate - 24h`. A cron invocation only sends when that fixed point
 * falls inside `(now - 5min, now]` — the same half-open-window trick
 * runOrganizerDigest uses for its once-a-day window. Under a reliable
 * 5-minute cron cadence every such instant is covered by exactly one
 * invocation's window, so no dedupe state is needed. The real tradeoff
 * (documented, not a bug): if the cron misses a window entirely — an outage,
 * a delayed deploy — the reminder for any registration whose instant fell
 * inside that gap is skipped for good, never retried on the next run.
 */
export async function runConferenceReminders(
  now: Date,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<{ sent: number }> {
  const windowStart = new Date(now.getTime() - CRON_WINDOW_MS)
  // mun.startDate - 24h must fall in (windowStart, now] <=> mun.startDate
  // falls in (windowStart + 24h, now + 24h].
  const lowerBoundExclusive = new Date(windowStart.getTime() + REMINDER_LEAD_MS)
  const upperBoundInclusive = new Date(now.getTime() + REMINDER_LEAD_MS)

  const rows = await db
    .select({
      registrationId: registrations.id,
      delegateEmail: users.email,
      delegateName: users.name,
      munName: muns.name,
      munSlug: muns.slug,
      startDate: muns.startDate,
      endDate: muns.endDate,
      venue: muns.venue,
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .where(
      and(
        eq(registrations.status, 'CONFIRMED'),
        gt(muns.startDate, lowerBoundExclusive),
        lte(muns.startDate, upperBoundInclusive),
      ),
    )

  const appUrl = getRuntimeEnv('APP_URL') ?? 'http://localhost:3000'
  let sent = 0

  await Promise.all(
    rows.map(async (row) => {
      // startDate is NOT NULL by the WHERE clause above (gt/lte against it
      // already excludes nulls), but the column itself is nullable in the
      // schema — narrow it for TypeScript.
      if (!row.startDate) return

      const passUrl = `${appUrl}/dashboard/registrations/${row.registrationId}/pass`
      const munUrl = buildPublicMunUrl(row.munSlug)
      const venueLine = row.venue ? `\nVenue: ${row.venue}` : ''

      try {
        await adapter.send({
          to: row.delegateEmail,
          subject: `${row.munName} starts tomorrow`,
          body:
            `Hi ${row.delegateName},\n\n` +
            `"${row.munName}" starts tomorrow (${formatDateRange(row.startDate, row.endDate)}).${venueLine}\n\n` +
            `Your pass: ${passUrl}\n` +
            `Conference details: ${munUrl}\n\n` +
            `See you there!`,
        })
        sent += 1
      } catch (error) {
        console.error('[reminder-job] delivery failed', { registrationId: row.registrationId, error })
      }
    }),
  )

  return { sent }
}
