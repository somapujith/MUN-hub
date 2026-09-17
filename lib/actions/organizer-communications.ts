import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { assertMunOwner } from '@/lib/actions/mun-access'
import { COMMUNICATION_LIMITS, ORGANIZER_OPS_ERRORS } from '@/lib/actions/organizer-ops-errors'
import type { Session } from '@/lib/auth/adapter'
import { db } from '@/lib/db/client'
import { muns, registrations, users, verificationLogs } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/db/schema-enums'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import { getNotificationsAdapter } from '@/lib/notifications/select-adapter'

// -----------------------------------------------------------------------------
// organizer-communications — plain-text messages from a MUN to its delegates
// -----------------------------------------------------------------------------
//
// An organizer writes a subject and a plain-text body, picks an audience
// (registration status / pass / committee), previews the recipient count and
// sends. Delivery goes through the platform notifications adapter
// (`getNotificationsAdapter` — ZeptoMail when configured, the console adapter
// in dev and tests), one recipient at a time, in order.
//
// These are operational conference messages (venue changes, schedules,
// reminders), so they deliberately IGNORE `users.emailNotificationsEnabled`:
// that preference covers optional product email, and a delegate who paid for
// a seat must still hear that the venue moved. The composer says so. Anything
// promotional does not belong in this tool.
//
// Limits (COMMUNICATION_LIMITS): subject and body lengths, at most 500
// recipients per message (narrow the audience and send in parts), and at most
// 5 messages per MUN per rolling hour. The hourly limit is counted from the
// audit rows below, under a row lock on the MUN, so it holds across Worker
// isolates and concurrent requests.
//
// Audit: each send writes one append-only `verification_logs` row (action
// `COMMUNICATION_SENT`, the MUN's general lifecycle audit trail — it is what
// the admin audit history reads for a MUN) before delivery starts. `notes`
// carries the subject and recipient count; `internal_notes` a small JSON
// record of the audience. Per-recipient delivery results are not stored (no
// send-history table yet — see the lane change log); the sender gets the
// sent/failed counts in the response.

export const COMMUNICATION_SENT_ACTION = 'COMMUNICATION_SENT'

/** Registration statuses a message can target — delegates who hold a seat. */
export const MESSAGEABLE_STATUSES = ['CONFIRMED', 'ATTENDED', 'NO_SHOW'] as const satisfies readonly RegistrationStatus[]
export type MessageableStatus = (typeof MESSAGEABLE_STATUSES)[number]

export interface CommunicationAudience {
  /** Omitted or empty means every seat-holding status. */
  statuses?: MessageableStatus[]
  registrationProductId?: string
  committeeId?: string
}

export interface AudiencePreview {
  recipientCount: number
  maxRecipientsPerSend: number
  sendsRemainingThisHour: number
}

export interface SendCommunicationInput {
  subject: string
  body: string
  audience: CommunicationAudience
}

export interface SendCommunicationResult {
  recipientCount: number
  sent: number
  failed: number
}

export interface CommunicationHistoryEntry {
  id: string
  sentAt: Date
  sentBy: string
  subject: string
  recipientCount: number
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Queryable = typeof db | Tx

const HOUR_MS = 3_600_000

function audienceConditions(munId: string, audience: CommunicationAudience) {
  const statuses = audience.statuses && audience.statuses.length > 0 ? audience.statuses : [...MESSAGEABLE_STATUSES]
  const conditions = [
    eq(registrations.munId, munId),
    inArray(registrations.status, statuses),
    // A suspended account gets nothing from the platform.
    eq(users.suspended, false),
  ]
  if (audience.registrationProductId) {
    conditions.push(eq(registrations.registrationProductId, audience.registrationProductId))
  }
  if (audience.committeeId) conditions.push(eq(registrations.committeeId, audience.committeeId))
  return and(...conditions)
}

/** Distinct recipients (one per account, even with two passes), capped at `limit`. */
function selectRecipients(client: Queryable, munId: string, audience: CommunicationAudience, limit: number) {
  return client
    .selectDistinct({ userId: users.id, email: users.email, name: users.name })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .where(audienceConditions(munId, audience))
    .orderBy(users.id)
    .limit(limit)
}

async function countRecipients(munId: string, audience: CommunicationAudience): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${users.id})::int` })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .where(audienceConditions(munId, audience))
  return row?.count ?? 0
}

async function countRecentSends(client: Queryable, munId: string): Promise<number> {
  const [row] = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(verificationLogs)
    .where(
      and(
        eq(verificationLogs.munId, munId),
        eq(verificationLogs.action, COMMUNICATION_SENT_ACTION),
        gt(verificationLogs.createdAt, new Date(Date.now() - HOUR_MS)),
      ),
    )
  return row?.count ?? 0
}

/** Validates and normalises the composed message. Throws a user-facing error. */
export function validateMessage(subjectInput: string, bodyInput: string): { subject: string; body: string } {
  const subject = subjectInput.trim()
  const body = bodyInput.replace(/\r\n?/g, '\n').trim()
  if (!subject) throw new Error('Subject is required')
  if (/[\r\n]/.test(subject)) throw new Error(ORGANIZER_OPS_ERRORS.subjectMultiline)
  if (subject.length > COMMUNICATION_LIMITS.subjectMaxLength) throw new Error(ORGANIZER_OPS_ERRORS.subjectTooLong)
  if (!body) throw new Error('Message is required')
  if (body.length > COMMUNICATION_LIMITS.bodyMaxLength) throw new Error(ORGANIZER_OPS_ERRORS.bodyTooLong)
  return { subject, body }
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Renders one delegate message. The organizer's text is only ever inserted
 * HTML-escaped (line breaks become `<br>`), so nothing they type can become
 * markup, a link or a tracking pixel in the delegate's inbox.
 */
export function renderDelegateMessage(input: {
  munName: string
  subject: string
  body: string
}): Pick<NotificationPayload, 'subject' | 'body' | 'html'> {
  const footer = `You're receiving this because you're registered for ${input.munName} on MUN Hub. Reply to the organizers through the contact details on the MUN's page.`
  const munName = escapeHtml(input.munName)
  const paragraphs = escapeHtml(input.body)
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px; font-size:15px; line-height:1.55; color:#181d26;">${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('')

  return {
    subject: `${input.munName}: ${input.subject}`,
    body: `${input.body}\n\n—\nSent by the organizers of ${input.munName}.\n${footer}`,
    html: `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f6f5f2; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f5f2; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="background-color:#181d26; padding:16px 24px;">
                <span style="font-size:14px; font-weight:700; color:#ffffff;">${munName}</span>
                <span style="font-size:13px; color:#c7c9cf;"> · via MUN Hub</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 12px;">
                <h1 style="margin:0 0 20px; font-size:20px; font-weight:700; color:#181d26;">${escapeHtml(input.subject)}</h1>
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 24px; border-top:1px solid #e6e4df;">
                <p style="margin:0; font-size:12px; line-height:1.5; color:#5d616b;">Sent by the organizers of ${munName}. ${escapeHtml(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  }
}

/**
 * How many delegates `audience` reaches, and how much sending room the MUN
 * has left this hour. Owning organizer only.
 */
export async function previewCommunicationAudience(
  munId: string,
  audience: CommunicationAudience,
  session: Session | null,
): Promise<AudiencePreview> {
  await assertMunOwner(munId, session)
  const [recipientCount, recentSends] = await Promise.all([
    countRecipients(munId, audience),
    countRecentSends(db, munId),
  ])
  return {
    recipientCount,
    maxRecipientsPerSend: COMMUNICATION_LIMITS.maxRecipientsPerSend,
    sendsRemainingThisHour: Math.max(0, COMMUNICATION_LIMITS.maxSendsPerHour - recentSends),
  }
}

/**
 * Sends one message to every delegate in `audience`. Owning organizer only.
 *
 * The limit checks, recipient snapshot and audit row happen in one
 * transaction under a row lock on the MUN; delivery runs after commit, one
 * recipient at a time. A failed delivery is logged and counted, never thrown —
 * the rest of the audience still gets the message.
 */
export async function sendMunCommunication(
  munId: string,
  input: SendCommunicationInput,
  session: Session | null,
): Promise<SendCommunicationResult> {
  const actor = await assertMunOwner(munId, session)
  const { subject, body } = validateMessage(input.subject, input.body)
  const cap = COMMUNICATION_LIMITS.maxRecipientsPerSend

  const { munName, recipients } = await db.transaction(async (tx) => {
    const [mun] = await tx.select({ name: muns.name }).from(muns).where(eq(muns.id, munId)).for('update').limit(1)
    if (!mun) throw new Error('Mun not found')

    if ((await countRecentSends(tx, munId)) >= COMMUNICATION_LIMITS.maxSendsPerHour) {
      throw new Error(ORGANIZER_OPS_ERRORS.hourlySendLimit)
    }

    const rows = await selectRecipients(tx, munId, input.audience, cap + 1)
    if (rows.length === 0) throw new Error(ORGANIZER_OPS_ERRORS.noRecipients)
    if (rows.length > cap) throw new Error(ORGANIZER_OPS_ERRORS.audienceTooLarge)

    await tx.insert(verificationLogs).values({
      munId,
      reviewerId: actor.userId,
      action: COMMUNICATION_SENT_ACTION,
      notes: `Delegate message "${subject}" to ${rows.length} recipient${rows.length === 1 ? '' : 's'}`,
      internalNotes: JSON.stringify({ kind: 'delegate_message', subject, recipientCount: rows.length, audience: input.audience }),
      createdAt: sql`clock_timestamp()`,
    })

    return { munName: mun.name, recipients: rows }
  })

  const message = renderDelegateMessage({ munName, subject, body })
  const adapter = getNotificationsAdapter()
  let sent = 0
  let failed = 0
  for (const [index, recipient] of recipients.entries()) {
    try {
      await adapter.send({ to: recipient.email, ...message })
      sent += 1
    } catch (error) {
      failed += 1
      // No address in the log line: the recipient index and user id are
      // enough to trace a failure without spreading delegate emails into logs.
      console.error(
        `[organizer-communications] delivery failed for mun ${munId}, recipient #${index} (user ${recipient.userId})`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return { recipientCount: recipients.length, sent, failed }
}

interface SendAuditRecord {
  subject?: unknown
  recipientCount?: unknown
}

function parseAuditRecord(raw: string | null): SendAuditRecord {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SendAuditRecord) : {}
  } catch {
    return {}
  }
}

/** The MUN's most recent delegate messages (subject, count, sender), newest first. Owning organizer only. */
export async function listMunCommunications(
  munId: string,
  session: Session | null,
  limit = 20,
): Promise<CommunicationHistoryEntry[]> {
  await assertMunOwner(munId, session)
  const rows = await db
    .select({
      id: verificationLogs.id,
      createdAt: verificationLogs.createdAt,
      internalNotes: verificationLogs.internalNotes,
      senderName: users.name,
    })
    .from(verificationLogs)
    .innerJoin(users, eq(users.id, verificationLogs.reviewerId))
    .where(and(eq(verificationLogs.munId, munId), eq(verificationLogs.action, COMMUNICATION_SENT_ACTION)))
    .orderBy(desc(verificationLogs.createdAt))
    .limit(limit)

  return rows.map((row) => {
    const record = parseAuditRecord(row.internalNotes)
    return {
      id: row.id,
      sentAt: row.createdAt,
      sentBy: row.senderName,
      subject: typeof record.subject === 'string' ? record.subject : '',
      recipientCount: typeof record.recipientCount === 'number' ? record.recipientCount : 0,
    }
  })
}
