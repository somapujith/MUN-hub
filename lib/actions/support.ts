import { and, asc, desc, eq, gt, isNull, ne, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportMessages, supportTickets, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { recordAdminAction } from '@/lib/audit/log'
import type { Role, SupportCategory, SupportPriority, SupportStatus } from '@/lib/db/schema-enums'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

function isAdminRole(role: Session['role']): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role)
}

/**
 * Allowed forward transitions for a support ticket. Lighter-weight than
 * `lib/lifecycle/mun-state-machine.ts`'s `ALLOWED_TRANSITIONS` (no money or
 * public visibility riding on a ticket's status), so this stays an inline
 * constant in this module rather than its own file. CLOSED and RESOLVED (except
 * RESOLVED -> CLOSED) are terminal — in particular a CLOSED ticket can never
 * move back to NEW, and RESOLVED -> RESOLVED is not reachable (so
 * TICKET_RESOLVED can only ever be logged once per ticket).
 */
const ALLOWED_TICKET_TRANSITIONS: Record<SupportStatus, SupportStatus[]> = {
  NEW: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING'],
  IN_PROGRESS: ['WAITING', 'RESOLVED'],
  WAITING: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
}

export type SupportTicketRow = typeof supportTickets.$inferSelect

export interface CreateTicketInput {
  category: SupportCategory
  priority?: SupportPriority
  subject: string
  description: string
  relatedRegistrationId?: string
  relatedMunId?: string
}

/**
 * Any authenticated user (student/organizer/admin) can open a ticket. Actor
 * is always derived from the caller-supplied `session` — never accept a
 * client-supplied `createdBy`, same rule as every other actor-scoped action.
 */
export async function createTicket(
  input: CreateTicketInput,
  session: Session | null,
): Promise<SupportTicketRow> {
  if (!session) throw new Error('Forbidden')

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      createdBy: session.userId,
      category: input.category,
      priority: input.priority ?? 'NORMAL',
      subject: input.subject,
      description: input.description,
      relatedRegistrationId: input.relatedRegistrationId,
      relatedMunId: input.relatedMunId,
    })
    .returning()

  return ticket
}

/**
 * OPERATIONS/ADMIN/SUPER_ADMIN only — the admin support queue. Signature is
 * intentionally unpaginated (`filters?: {status}` -> full array): the admin
 * support page and the admin overview dashboard's ticket count both call
 * this directly and expect a plain array, not a paginated shape. Ticket
 * volume for this MVP is low enough that an unbounded read is acceptable;
 * revisit with real pagination if that stops being true.
 */
export async function listTickets(
  filters: { status?: SupportStatus } = {},
  session: Session | null,
): Promise<SupportTicketRow[]> {
  requireRole(session, [...ADMIN_ROLES])

  if (filters.status) {
    return db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.status, filters.status))
      .orderBy(desc(supportTickets.createdAt))
  }
  return db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt))
}

export interface AdminTicketListItem extends SupportTicketRow {
  requesterName: string
  requesterRole: Role
}

/**
 * Same admin queue as `listTickets`, joined with the requester's name/role
 * so the admin support page can label each conversation "Student"/
 * "Organizer" ("mapped to admin" — every widget-originated conversation,
 * from either role, lands in this one queue). Kept as a separate function
 * rather than widening `listTickets`'s return type, since that type is a
 * frozen `SupportTicketRow[]` contract two existing call sites depend on.
 */
export async function listTicketsWithRequester(
  filters: { status?: SupportStatus } = {},
  session: Session | null,
): Promise<AdminTicketListItem[]> {
  requireRole(session, [...ADMIN_ROLES])

  const conditions = filters.status ? [eq(supportTickets.status, filters.status)] : []

  const rows = await db
    .select({ ticket: supportTickets, requesterName: users.name, requesterRole: users.role })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.createdBy, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTickets.createdAt))

  return rows.map(({ ticket, requesterName, requesterRole }) => ({ ...ticket, requesterName, requesterRole }))
}

/**
 * Self-assigns a ticket to the acting session and moves it to ASSIGNED. Logs
 * TICKET_ASSIGNED. The assignee is always `session.userId` — never a
 * client-supplied id — matching the UI, which only ever offers an "assign to
 * me" action (see `app/admin/support/ticket-row.tsx`; there is no picker for
 * assigning to a different admin). Accepting an arbitrary `assigneeId`
 * parameter here would let any caller reaching this action assign a ticket
 * to a third party it never authenticated as.
 */
export async function assignTicket(ticketId: string, session: Session | null): Promise<SupportTicketRow> {
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(supportTickets)
      .set({ assignedTo: session.userId, status: 'ASSIGNED', updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId))
      .returning()

    await recordAdminAction(tx, session.userId, 'TICKET_ASSIGNED', 'support_ticket', ticketId)

    return updated
  })
}

/**
 * Transitions a ticket's status (e.g. IN_PROGRESS/WAITING/RESOLVED/CLOSED),
 * guarded by `ALLOWED_TICKET_TRANSITIONS` — throws on an invalid transition
 * (e.g. CLOSED -> NEW, or RESOLVED -> RESOLVED) instead of writing it
 * unconditionally. Only RESOLVED writes an admin_actions row
 * (TICKET_RESOLVED) — that's the only status transition in
 * `adminActionEnum`; other transitions are ordinary queue management and
 * don't need an audit entry. The transition guard also means RESOLVED can
 * only ever be reached once per ticket (RESOLVED -> RESOLVED isn't a legal
 * transition), so TICKET_RESOLVED can never be logged twice for the same
 * ticket.
 */
export async function updateTicketStatus(
  ticketId: string,
  status: SupportStatus,
  resolutionNotes: string | undefined,
  session: Session | null,
): Promise<SupportTicketRow> {
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .for('update')
      .limit(1)

    if (!current) throw new Error('Ticket not found')

    if (!ALLOWED_TICKET_TRANSITIONS[current.status].includes(status)) {
      throw new Error(`Invalid ticket transition: ${current.status} -> ${status}`)
    }

    const [updated] = await tx
      .update(supportTickets)
      .set({ status, resolutionNotes, updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId))
      .returning()

    if (status === 'RESOLVED') {
      await recordAdminAction(tx, session.userId, 'TICKET_RESOLVED', 'support_ticket', ticketId, resolutionNotes)
    }

    return updated
  })
}

// ---------------------------------------------------------------------------
// Chat thread (support widget) — layered on top of the ticket lifecycle
// above rather than replacing it. A ticket's `status` still only ever moves
// through `ALLOWED_TICKET_TRANSITIONS` via `assignTicket`/`updateTicketStatus`;
// sending a message never touches it, so the existing admin queue keeps
// working exactly as before. Only a CLOSED ticket rejects new messages —
// RESOLVED still accepts follow-ups (e.g. "actually it's still broken"),
// same as most helpdesks.
// ---------------------------------------------------------------------------

export type SupportMessageRow = typeof supportMessages.$inferSelect

function assertCanAccessTicket(ticket: { createdBy: string }, session: Session): void {
  if (session.userId !== ticket.createdBy && !isAdminRole(session.role)) {
    throw new Error('Forbidden')
  }
}

/**
 * Quick-start entry point for the floating support widget — no category
 * picker, no separate subject field. Creates the ticket and its opening
 * message in one transaction; `subject` is derived from the message body
 * (matches how Intercom/Zendesk launchers title a fresh conversation from
 * the first thing the user types).
 */
export async function startConversation(
  input: { body: string; category?: SupportCategory; relatedMunId?: string },
  session: Session | null,
): Promise<{ ticket: SupportTicketRow; message: SupportMessageRow }> {
  if (!session) throw new Error('Forbidden')

  const body = input.body.trim()
  if (!body) throw new Error('Message cannot be empty')

  const subject = body.length > 80 ? `${body.slice(0, 77)}...` : body

  return db.transaction(async (tx) => {
    const now = new Date()
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        createdBy: session.userId,
        category: input.category ?? 'GENERAL',
        subject,
        description: body,
        relatedMunId: input.relatedMunId,
        lastMessageAt: now,
        lastMessageSenderId: session.userId,
        requesterReadAt: now,
      })
      .returning()

    const [message] = await tx
      .insert(supportMessages)
      .values({ ticketId: ticket.id, senderId: session.userId, senderRole: session.role, body })
      .returning()

    return { ticket, message }
  })
}

/**
 * Posts a reply into an existing conversation — the requester (ticket owner)
 * or any admin-role user. Bumps the sender's own read marker to now in the
 * same write, since sending trivially means you're caught up on your own
 * side of the thread.
 */
export async function sendMessage(
  ticketId: string,
  body: string,
  session: Session | null,
): Promise<SupportMessageRow> {
  if (!session) throw new Error('Forbidden')

  const trimmed = body.trim()
  if (!trimmed) throw new Error('Message cannot be empty')

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select({ createdBy: supportTickets.createdBy, status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .for('update')
      .limit(1)

    if (!ticket) throw new Error('Ticket not found')
    assertCanAccessTicket(ticket, session)
    if (ticket.status === 'CLOSED') throw new Error('This conversation is closed.')

    const now = new Date()
    const isRequester = session.userId === ticket.createdBy

    const [message] = await tx
      .insert(supportMessages)
      .values({ ticketId, senderId: session.userId, senderRole: session.role, body: trimmed })
      .returning()

    await tx
      .update(supportTickets)
      .set({
        lastMessageAt: now,
        lastMessageSenderId: session.userId,
        updatedAt: now,
        ...(isRequester ? { requesterReadAt: now } : { adminReadAt: now }),
      })
      .where(eq(supportTickets.id, ticketId))

    return message
  })
}

/**
 * Full thread for one conversation — the requester or any admin-role user.
 * Used by both the floating widget and the full-page inbox routes (student,
 * organizer, admin) so there is exactly one read path for a thread's shape.
 */
export async function getConversation(
  ticketId: string,
  session: Session | null,
): Promise<{ ticket: SupportTicketRow; messages: SupportMessageRow[] }> {
  if (!session) throw new Error('Forbidden')

  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1)
  if (!ticket) throw new Error('Ticket not found')
  assertCanAccessTicket(ticket, session)

  const messages = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(asc(supportMessages.createdAt))

  return { ticket, messages }
}

/**
 * Marks a conversation read on the caller's side of it. Admin-side read is
 * shared across every admin/operations user rather than per-admin — same
 * scale tradeoff `assignTicket` already makes by not modeling a reviewer
 * queue with per-reviewer state; revisit only if per-admin read receipts
 * turn out to matter.
 */
export async function markConversationRead(ticketId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')

  const [ticket] = await db
    .select({ createdBy: supportTickets.createdBy })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!ticket) throw new Error('Ticket not found')
  assertCanAccessTicket(ticket, session)

  const isRequester = session.userId === ticket.createdBy
  await db
    .update(supportTickets)
    .set(isRequester ? { requesterReadAt: new Date() } : { adminReadAt: new Date() })
    .where(eq(supportTickets.id, ticketId))
}

/**
 * A student's or organizer's own conversations — the floating widget's and
 * `/dashboard/support` / `/organizer/support`'s conversation list. Newest
 * activity first, falling back to `createdAt` for tickets filed through the
 * older `/support/new` form that never got a chat reply (`lastMessageAt` is
 * still null on those).
 */
export async function listMyConversations(session: Session | null): Promise<SupportTicketRow[]> {
  if (!session) throw new Error('Forbidden')

  const rows = await db.select().from(supportTickets).where(eq(supportTickets.createdBy, session.userId))

  return rows.sort((a, b) => {
    const at = (a.lastMessageAt ?? a.createdAt).getTime()
    const bt = (b.lastMessageAt ?? b.createdAt).getTime()
    return bt - at
  })
}

/**
 * Unread-conversation count for the requester side (floating widget badge).
 * A ticket counts once, not per-message — the badge is "N conversations
 * need your attention", matching how Intercom/Zendesk launchers badge.
 */
export async function getUnreadConversationCount(session: Session | null): Promise<number> {
  if (!session) return 0

  const rows = await db
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.createdBy, session.userId),
        ne(supportTickets.lastMessageSenderId, session.userId),
        or(isNull(supportTickets.requesterReadAt), gt(supportTickets.lastMessageAt, supportTickets.requesterReadAt)),
      ),
    )

  return rows.length
}

/**
 * Unread-conversation count for the admin side (any OPERATIONS/ADMIN/
 * SUPER_ADMIN) — conversations whose last message came from the requester
 * and haven't been opened by an admin since. Surfaced on `/admin/support`.
 */
export async function getAdminUnreadConversationCount(session: Session | null): Promise<number> {
  requireRole(session, [...ADMIN_ROLES])

  const rows = await db
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.lastMessageSenderId, supportTickets.createdBy),
        or(isNull(supportTickets.adminReadAt), gt(supportTickets.lastMessageAt, supportTickets.adminReadAt)),
      ),
    )

  return rows.length
}
