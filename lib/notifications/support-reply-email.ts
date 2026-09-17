import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportTickets, users } from '@/lib/db/schema'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { isEmailNotificationsEnabled } from './email-preference'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

/**
 * Deep link straight to this ticket's thread, by the requester's role —
 * `/dashboard/support?ticket=<id>` for delegates, `/organizer/support?ticket=<id>`
 * for organizers (support lane, landed 2026-09-17 — the inboxes now read the
 * `ticket` query param to open that conversation directly).
 */
function supportTicketUrl(role: string, ticketId: string): string {
  const baseUrl = getRuntimeEnv('APP_URL') ?? 'http://localhost:3000'
  const path = role === 'ORGANIZER' ? '/organizer/support' : '/dashboard/support'
  return `${baseUrl}${path}?ticket=${ticketId}`
}

/**
 * "Staff replied to your support ticket" — the email-channel companion to
 * the in-app chat widget (lib/actions/support.ts#sendMessage), which is
 * otherwise poll-only with no out-of-band notice. Intentionally does NOT
 * echo the message body into the email (same reasoning most helpdesks use:
 * avoid putting potentially sensitive conversation content in an inbox that
 * may be less secure than the app itself) — just a pointer back to the
 * conversation.
 *
 * Call this only when the sender was staff (`senderId !== ticket.createdBy`
 * — see lib/actions/support.ts's own comment on that exact check); never
 * when the requester replies to their own ticket.
 */
export async function notifySupportReply(
  ticketId: string,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const [row] = await db
    .select({
      subject: supportTickets.subject,
      requesterId: supportTickets.createdBy,
      requesterEmail: users.email,
      requesterName: users.name,
      requesterRole: users.role,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.createdBy, users.id))
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!row) throw new Error('Ticket not found')
  if (!(await isEmailNotificationsEnabled(row.requesterId))) return

  try {
    await adapter.send({
      to: row.requesterEmail,
      subject: `New reply on your support ticket — ${row.subject}`,
      body:
        `Hi ${row.requesterName},\n\n` +
        `Our team replied to your support conversation "${row.subject}".\n\n` +
        `View it here: ${supportTicketUrl(row.requesterRole, ticketId)}`,
    })
  } catch (error) {
    console.error('[support-reply-email] delivery failed', { ticketId, error })
  }
}
