import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db/client'
import { muns, registrations, supportMessages, supportTickets, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { recordAdminAction } from '@/lib/audit/log'
import { runInBackground } from '@/lib/background-tasks'
import { notifySupportReply } from '@/lib/notifications/support-reply-email'
import {
  supportCategoryEnum,
  type Role,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from '@/lib/db/schema-enums'

// ---------------------------------------------------------------------------
// Support desk — one conversation model.
//
// A ticket (support_tickets) has a subject, category, priority, status and a
// message thread (support_messages). Every entry point — the floating chat
// widget, the /support/new form, the organizer inbox — creates the ticket AND
// its opening message, so the requester and staff always read the same
// thread. `description` keeps the opening text on the ticket row for the
// queue preview and for legacy rows filed before the form wrote a message.
//
// Identity is always the caller's `session`; a requester only ever reaches
// their own tickets, staff (OPERATIONS/ADMIN/SUPER_ADMIN) reach all of them.
// There are no internal staff notes yet (the schema has no visibility flag on
// support_messages), so every message is visible to the requester.
// ---------------------------------------------------------------------------

export const STAFF_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const satisfies readonly Role[]

export function isSupportStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role)
}

/** Input bounds, shared with server/routes/support.ts's request schemas. */
export const SUPPORT_LIMITS = {
  subject: 150,
  body: 5000,
  resolutionNotes: 2000,
  search: 100,
  pageSizeDefault: 25,
  pageSizeMax: 100,
  /** A thread longer than this is abuse, not support — only the latest messages are returned. */
  threadMax: 1000,
} as const

/** Statuses that still need staff attention. */
export const OPEN_TICKET_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'] as const satisfies readonly SupportStatus[]

/**
 * Categories a requester can file under. REFUND stays in the database enum for
 * rows filed before this product dropped refunds, but it is never offered or
 * accepted for a new ticket.
 */
export const REQUESTER_CATEGORIES = supportCategoryEnum.enumValues.filter(
  (category): category is Exclude<SupportCategory, 'REFUND'> => category !== 'REFUND',
)

export type RequesterCategory = (typeof REQUESTER_CATEGORIES)[number]

const CONVERSATION_CLOSED = 'This conversation is closed.'

// ---------------------------------------------------------------------------
// Ticket state machine
// ---------------------------------------------------------------------------

/**
 * Legal status changes. NEW -> ASSIGNED happens only through assignment
 * (`assignTicket`, or a staff member's first reply). RESOLVED -> IN_PROGRESS
 * is the reopen path, taken when the requester replies to a resolved ticket
 * or staff reopen it. CLOSED is terminal: a closed conversation takes no more
 * messages, and the requester starts a new one instead.
 */
export const ALLOWED_TICKET_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  NEW: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING'],
  IN_PROGRESS: ['WAITING', 'RESOLVED'],
  WAITING: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
}

export function canTransitionTicket(from: SupportStatus, to: SupportStatus): boolean {
  return ALLOWED_TICKET_TRANSITIONS[from].includes(to)
}

/** What a staff reply leaves the ticket as: waiting on the requester by default, or still in progress. */
export type StaffReplyStatus = 'WAITING' | 'IN_PROGRESS'

/**
 * Status after a staff reply. A NEW ticket is assigned to the replier on the
 * way (NEW -> ASSIGNED -> next). A RESOLVED ticket stays resolved — a
 * follow-up note from staff doesn't reopen it.
 */
export function statusAfterStaffReply(current: SupportStatus, next: StaffReplyStatus = 'WAITING'): SupportStatus {
  switch (current) {
    case 'CLOSED':
      throw new Error(CONVERSATION_CLOSED)
    case 'RESOLVED':
      return 'RESOLVED'
    default:
      return next
  }
}

/**
 * Status after the requester replies: the ball is back with staff, so a
 * ticket waiting on the requester — or already resolved — goes (back) to IN_PROGRESS.
 */
export function statusAfterRequesterReply(current: SupportStatus): SupportStatus {
  switch (current) {
    case 'CLOSED':
      throw new Error(CONVERSATION_CLOSED)
    case 'WAITING':
    case 'RESOLVED':
      return 'IN_PROGRESS'
    default:
      return current
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type SupportTicketRow = typeof supportTickets.$inferSelect
export type SupportMessageRow = typeof supportMessages.$inferSelect

/** What the requester sees of their own ticket — no staff ids or staff read state. */
export interface SupportTicketView {
  id: string
  createdBy: string
  category: SupportCategory
  priority: SupportPriority
  status: SupportStatus
  subject: string
  description: string
  relatedMunId: string | null
  relatedRegistrationId: string | null
  resolutionNotes: string | null
  lastMessageAt: Date | null
  /** `lastMessageAt`, or `createdAt` for a ticket with no messages. Lists sort on this. */
  lastActivityAt: Date
  /** True when the latest message came from the support team. */
  lastMessageFromStaff: boolean
  /** Has a message the viewer hasn't seen yet. */
  unread: boolean
  createdAt: Date
  updatedAt: Date
}

/** What staff see: the requester view plus who filed it, who owns it, and the related MUN. */
export interface StaffTicketView extends SupportTicketView {
  assignedTo: string | null
  assigneeName: string | null
  requesterName: string
  requesterEmail: string
  requesterRole: Role
  relatedMunName: string | null
  requesterReadAt: Date | null
  adminReadAt: Date | null
}

export interface SupportMessageView {
  id: string
  ticketId: string
  author: 'REQUESTER' | 'STAFF'
  /** Null for a staff message shown to the requester — staff reply as "the support team". */
  senderId: string | null
  /** The sender's name, for staff viewers only. */
  senderName: string | null
  senderRole: Role
  body: string
  createdAt: Date
}

export type ConversationView =
  | { viewer: 'REQUESTER'; ticket: SupportTicketView; messages: SupportMessageView[] }
  | { viewer: 'STAFF'; ticket: StaffTicketView; messages: SupportMessageView[] }

export interface Page<T> {
  results: T[]
  total: number
}

function lastMessageFromStaff(ticket: SupportTicketRow): boolean {
  return ticket.lastMessageSenderId !== null && ticket.lastMessageSenderId !== ticket.createdBy
}

function isAfter(at: Date | null, readAt: Date | null): boolean {
  if (!at) return false
  return readAt === null || at.getTime() > readAt.getTime()
}

function toRequesterView(ticket: SupportTicketRow): SupportTicketView {
  return {
    id: ticket.id,
    createdBy: ticket.createdBy,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    description: ticket.description,
    relatedMunId: ticket.relatedMunId,
    relatedRegistrationId: ticket.relatedRegistrationId,
    resolutionNotes: ticket.resolutionNotes,
    lastMessageAt: ticket.lastMessageAt,
    lastActivityAt: ticket.lastMessageAt ?? ticket.createdAt,
    lastMessageFromStaff: lastMessageFromStaff(ticket),
    unread: lastMessageFromStaff(ticket) && isAfter(ticket.lastMessageAt, ticket.requesterReadAt),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  }
}

interface StaffTicketJoin {
  ticket: SupportTicketRow
  requesterName: string
  requesterEmail: string
  requesterRole: Role
  assigneeName: string | null
  relatedMunName: string | null
}

function toStaffView(row: StaffTicketJoin): StaffTicketView {
  const { ticket } = row
  const fromRequester = ticket.lastMessageSenderId !== null && ticket.lastMessageSenderId === ticket.createdBy
  return {
    ...toRequesterView(ticket),
    unread: ticket.status !== 'CLOSED' && fromRequester && isAfter(ticket.lastMessageAt, ticket.adminReadAt),
    assignedTo: ticket.assignedTo,
    assigneeName: row.assigneeName,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    requesterRole: row.requesterRole,
    relatedMunName: row.relatedMunName,
    requesterReadAt: ticket.requesterReadAt,
    adminReadAt: ticket.adminReadAt,
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

const assignee = alias(users, 'support_assignee')

function staffTicketQuery(executor: Executor) {
  return executor
    .select({
      ticket: supportTickets,
      requesterName: users.name,
      requesterEmail: users.email,
      requesterRole: users.role,
      assigneeName: assignee.name,
      relatedMunName: muns.name,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.createdBy, users.id))
    .leftJoin(assignee, eq(supportTickets.assignedTo, assignee.id))
    .leftJoin(muns, eq(supportTickets.relatedMunId, muns.id))
}

async function loadStaffTicket(executor: Executor, ticketId: string): Promise<StaffTicketView> {
  const [row] = await staffTicketQuery(executor).where(eq(supportTickets.id, ticketId)).limit(1)
  if (!row) throw new Error('Ticket not found')
  return toStaffView(row)
}

const lastActivity = sql`coalesce(${supportTickets.lastMessageAt}, ${supportTickets.createdAt})`

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

/**
 * Trims and bounds a text field. The HTTP layer validates the same bounds
 * first, so these throws only fire for direct (non-HTTP) callers; the
 * "is required" wording maps to 400 in server/middleware/error.ts.
 */
function requireText(value: string | undefined, label: string, max: number): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) throw new Error(`${label} is required`)
  if (trimmed.length > max) throw new Error(`${label} must be at most ${max} characters`)
  return trimmed
}

function messageBody(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Message cannot be empty')
  if (trimmed.length > SUPPORT_LIMITS.body) {
    throw new Error(`Message must be at most ${SUPPORT_LIMITS.body} characters`)
  }
  return trimmed
}

function requesterCategory(category: SupportCategory | undefined, fallback: RequesterCategory): RequesterCategory {
  if (category === undefined) return fallback
  if (!(REQUESTER_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error('A supported category is required')
  }
  return category as RequesterCategory
}

function pageBounds(params: { limit?: number; offset?: number }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? SUPPORT_LIMITS.pageSizeDefault), 1), SUPPORT_LIMITS.pageSizeMax)
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0)
  return { limit, offset }
}

/**
 * A requester may only point a ticket at records that are theirs: an
 * organizer at a MUN they run (or a registration for it), a delegate at their
 * own registration or a MUN they registered for. Staff filing a ticket may
 * reference anything that exists.
 */
async function assertRelatedRecordsAllowed(
  input: { relatedMunId?: string; relatedRegistrationId?: string },
  session: Session,
): Promise<void> {
  const staff = isSupportStaff(session.role)

  if (input.relatedMunId) {
    const [mun] = await db
      .select({ organizerId: muns.organizerId })
      .from(muns)
      .where(eq(muns.id, input.relatedMunId))
      .limit(1)
    if (!mun) throw new Error('Mun not found')
    if (!staff && mun.organizerId !== session.userId) {
      const [registered] = await db
        .select({ id: registrations.id })
        .from(registrations)
        .where(and(eq(registrations.munId, input.relatedMunId), eq(registrations.userId, session.userId)))
        .limit(1)
      if (!registered) throw new Error('Forbidden')
    }
  }

  if (input.relatedRegistrationId) {
    const [registration] = await db
      .select({ userId: registrations.userId, organizerId: muns.organizerId, munId: registrations.munId })
      .from(registrations)
      .innerJoin(muns, eq(registrations.munId, muns.id))
      .where(eq(registrations.id, input.relatedRegistrationId))
      .limit(1)
    if (!registration) throw new Error('Registration not found')
    if (!staff && registration.userId !== session.userId && registration.organizerId !== session.userId) {
      throw new Error('Forbidden')
    }
    if (input.relatedMunId && registration.munId !== input.relatedMunId) {
      throw new Error('Forbidden')
    }
  }
}

async function lockTicket(tx: Tx, ticketId: string): Promise<SupportTicketRow> {
  const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for('update').limit(1)
  if (!ticket) throw new Error('Ticket not found')
  return ticket
}

function assertCanAccessTicket(ticket: { createdBy: string }, session: Session): void {
  if (session.userId !== ticket.createdBy && !isSupportStaff(session.role)) {
    throw new Error('Forbidden')
  }
}

// ---------------------------------------------------------------------------
// Creating conversations
// ---------------------------------------------------------------------------

export interface CreateTicketInput {
  category: SupportCategory
  priority?: SupportPriority
  subject: string
  description: string
  relatedRegistrationId?: string
  relatedMunId?: string
}

async function insertConversation(
  session: Session,
  values: {
    category: RequesterCategory
    priority: SupportPriority
    subject: string
    body: string
    relatedMunId?: string
    relatedRegistrationId?: string
  },
): Promise<{ ticket: SupportTicketRow; message: SupportMessageRow }> {
  return db.transaction(async (tx) => {
    const now = new Date()
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        createdBy: session.userId,
        category: values.category,
        priority: values.priority,
        subject: values.subject,
        description: values.body,
        relatedMunId: values.relatedMunId,
        relatedRegistrationId: values.relatedRegistrationId,
        lastMessageAt: now,
        lastMessageSenderId: session.userId,
        requesterReadAt: now,
      })
      .returning()

    const [message] = await tx
      .insert(supportMessages)
      .values({ ticketId: ticket.id, senderId: session.userId, senderRole: session.role, body: values.body })
      .returning()

    return { ticket, message }
  })
}

/**
 * The full form (/support/new): category, subject, description and an
 * optional related MUN/registration. The description becomes the thread's
 * opening message.
 */
export async function createTicket(input: CreateTicketInput, session: Session | null): Promise<SupportTicketView> {
  if (!session) throw new Error('Forbidden')

  const subject = requireText(input.subject, 'Subject', SUPPORT_LIMITS.subject)
  const body = requireText(input.description, 'Description', SUPPORT_LIMITS.body)
  const category = requesterCategory(input.category, 'GENERAL')
  await assertRelatedRecordsAllowed(input, session)

  const { ticket } = await insertConversation(session, {
    category,
    priority: input.priority ?? 'NORMAL',
    subject,
    body,
    relatedMunId: input.relatedMunId,
    relatedRegistrationId: input.relatedRegistrationId,
  })
  return toRequesterView(ticket)
}

/**
 * The chat widget's quick start: just a message. The subject is derived from
 * its first line, the category defaults to GENERAL.
 */
export async function startConversation(
  input: { body: string; category?: SupportCategory; relatedMunId?: string },
  session: Session | null,
): Promise<{ ticket: SupportTicketView; message: SupportMessageView }> {
  if (!session) throw new Error('Forbidden')

  const body = messageBody(input.body)
  const category = requesterCategory(input.category, 'GENERAL')
  await assertRelatedRecordsAllowed(input, session)

  const firstLine = body.split('\n', 1)[0].trim()
  const max = 80
  const subject = firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine

  const { ticket, message } = await insertConversation(session, {
    category,
    priority: 'NORMAL',
    subject,
    body,
    relatedMunId: input.relatedMunId,
  })
  return { ticket: toRequesterView(ticket), message: toMessageView(message, ticket, 'REQUESTER', null) }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function toMessageView(
  message: SupportMessageRow,
  ticket: { createdBy: string },
  viewer: 'REQUESTER' | 'STAFF',
  senderName: string | null,
): SupportMessageView {
  const author = message.senderId === ticket.createdBy ? 'REQUESTER' : 'STAFF'
  const hideSender = viewer === 'REQUESTER' && author === 'STAFF'
  return {
    id: message.id,
    ticketId: message.ticketId,
    author,
    senderId: hideSender ? null : message.senderId,
    senderName: viewer === 'STAFF' ? senderName : null,
    senderRole: message.senderRole,
    body: message.body,
    createdAt: message.createdAt,
  }
}

/**
 * One conversation with its thread, oldest message first (ties broken by id
 * so the order is stable). Staff get the staff view; the requester gets the
 * requester view; anyone else is refused.
 */
export async function getConversation(ticketId: string, session: Session | null): Promise<ConversationView> {
  if (!session) throw new Error('Forbidden')

  const [row] = await staffTicketQuery(db).where(eq(supportTickets.id, ticketId)).limit(1)
  if (!row) throw new Error('Ticket not found')
  assertCanAccessTicket(row.ticket, session)

  const viewer = isSupportStaff(session.role) ? 'STAFF' : 'REQUESTER'

  const latest = await db
    .select({ message: supportMessages, senderName: users.name })
    .from(supportMessages)
    .innerJoin(users, eq(supportMessages.senderId, users.id))
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id))
    .limit(SUPPORT_LIMITS.threadMax)

  const messages = latest
    .reverse()
    .map(({ message, senderName }) => toMessageView(message, row.ticket, viewer, senderName))

  return viewer === 'STAFF'
    ? { viewer, ticket: toStaffView(row), messages }
    : { viewer, ticket: toRequesterView(row.ticket), messages }
}

/**
 * The caller's own conversations, most recent activity first — the widget's
 * and the /dashboard/support + /organizer/support inbox list.
 */
export async function listMyConversations(
  session: Session | null,
  params: { limit?: number; offset?: number } = {},
): Promise<Page<SupportTicketView>> {
  if (!session) throw new Error('Forbidden')
  const { limit, offset } = pageBounds(params)
  const mine = eq(supportTickets.createdBy, session.userId)

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(supportTickets)
      .where(mine)
      .orderBy(desc(lastActivity), desc(supportTickets.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(supportTickets).where(mine),
  ])

  return { results: rows.map(toRequesterView), total }
}

export interface StaffTicketFilters {
  /** One status, or OPEN for everything that still needs staff attention. */
  status?: SupportStatus | 'OPEN'
  category?: SupportCategory
  priority?: SupportPriority
  /** `me`: assigned to the caller. `unassigned`: nobody owns it yet. */
  assignee?: 'me' | 'unassigned'
  /** Matches the subject, the requester's name or email, or an exact ticket id. */
  q?: string
  limit?: number
  offset?: number
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

/** The staff support queue — OPERATIONS/ADMIN/SUPER_ADMIN only, filtered and paginated. */
export async function listStaffTickets(
  filters: StaffTicketFilters,
  session: Session | null,
): Promise<Page<StaffTicketView>> {
  requireRole(session, [...STAFF_ROLES])
  const { limit, offset } = pageBounds(filters)

  const conditions: SQL[] = []
  if (filters.status === 'OPEN') conditions.push(inArray(supportTickets.status, [...OPEN_TICKET_STATUSES]))
  else if (filters.status) conditions.push(eq(supportTickets.status, filters.status))
  if (filters.category) conditions.push(eq(supportTickets.category, filters.category))
  if (filters.priority) conditions.push(eq(supportTickets.priority, filters.priority))
  if (filters.assignee === 'me') conditions.push(eq(supportTickets.assignedTo, session.userId))
  if (filters.assignee === 'unassigned') conditions.push(isNull(supportTickets.assignedTo))

  const q = filters.q?.trim().slice(0, SUPPORT_LIMITS.search)
  if (q) {
    const pattern = `%${escapeLike(q)}%`
    conditions.push(
      or(
        ilike(supportTickets.subject, pattern),
        ilike(users.name, pattern),
        ilike(users.email, pattern),
        eq(supportTickets.id, q),
      ) as SQL,
    )
  }

  const where = conditions.length ? and(...conditions) : undefined

  const [rows, [{ total }]] = await Promise.all([
    staffTicketQuery(db)
      .where(where)
      .orderBy(desc(lastActivity), desc(supportTickets.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(supportTickets)
      .innerJoin(users, eq(supportTickets.createdBy, users.id))
      .where(where),
  ])

  return { results: rows.map(toStaffView), total }
}

/**
 * Every ticket, unjoined and unpaginated — kept for the admin overview's
 * open-ticket count (lib/actions/admin-audit.ts). The queue itself uses
 * `listStaffTickets`.
 */
export async function listTickets(
  filters: { status?: SupportStatus } = {},
  session: Session | null,
): Promise<SupportTicketRow[]> {
  requireRole(session, [...STAFF_ROLES])

  return db
    .select()
    .from(supportTickets)
    .where(filters.status ? eq(supportTickets.status, filters.status) : undefined)
    .orderBy(desc(supportTickets.createdAt))
}

/** Conversations with a support-team message the requester hasn't opened — the widget badge. */
export async function getUnreadConversationCount(session: Session | null): Promise<number> {
  if (!session) return 0

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.createdBy, session.userId),
        ne(supportTickets.lastMessageSenderId, session.userId),
        or(isNull(supportTickets.requesterReadAt), gt(supportTickets.lastMessageAt, supportTickets.requesterReadAt)),
      ),
    )

  return count
}

/**
 * Conversations whose latest message is from the requester and that no staff
 * member has opened since. Read state is shared across staff (one
 * `adminReadAt` per ticket), not tracked per staff member.
 */
export async function getAdminUnreadConversationCount(session: Session | null): Promise<number> {
  requireRole(session, [...STAFF_ROLES])

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(
      and(
        ne(supportTickets.status, 'CLOSED'),
        eq(supportTickets.lastMessageSenderId, supportTickets.createdBy),
        or(isNull(supportTickets.adminReadAt), gt(supportTickets.lastMessageAt, supportTickets.adminReadAt)),
      ),
    )

  return count
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Marks the conversation read on the caller's side (requester, staff, or both if staff filed it). */
export async function markConversationRead(ticketId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')

  const [ticket] = await db
    .select({ createdBy: supportTickets.createdBy })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1)

  if (!ticket) throw new Error('Ticket not found')
  assertCanAccessTicket(ticket, session)

  const now = new Date()
  await db
    .update(supportTickets)
    .set({
      ...(session.userId === ticket.createdBy ? { requesterReadAt: now } : {}),
      ...(isSupportStaff(session.role) ? { adminReadAt: now } : {}),
    })
    .where(eq(supportTickets.id, ticketId))
}

/**
 * Posts a message into a conversation and moves the ticket along:
 *
 * - requester reply: WAITING or RESOLVED -> IN_PROGRESS (a reply reopens a
 *   resolved ticket and clears its now-stale resolution note)
 * - staff reply: -> WAITING (waiting on the requester) by default, or
 *   IN_PROGRESS when `nextStatus` says so; a NEW ticket is assigned to the
 *   replier on the way; a RESOLVED ticket stays resolved
 * - CLOSED takes no messages
 *
 * The sender's own read marker moves to now. A staff reply emails the
 * requester after the transaction commits.
 */
export async function sendMessage(
  ticketId: string,
  body: string,
  session: Session | null,
  options: { nextStatus?: StaffReplyStatus } = {},
): Promise<{ message: SupportMessageView; ticket: SupportTicketView | StaffTicketView }> {
  if (!session) throw new Error('Forbidden')
  const text = messageBody(body)

  let isStaffReply = false

  const result = await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId)
    assertCanAccessTicket(ticket, session)

    const isRequester = session.userId === ticket.createdBy
    isStaffReply = !isRequester
    if (options.nextStatus && !isStaffReply) throw new Error('Forbidden')

    const status = isStaffReply
      ? statusAfterStaffReply(ticket.status, options.nextStatus)
      : statusAfterRequesterReply(ticket.status)

    const claim = isStaffReply && ticket.status === 'NEW' && ticket.assignedTo === null
    const reopened = ticket.status === 'RESOLVED' && status === 'IN_PROGRESS'

    const now = new Date()
    // clock_timestamp(), not the transaction-start now(): read after the row
    // lock above, so concurrent replies to one ticket are timestamped in the
    // order they were written.
    const [inserted] = await tx
      .insert(supportMessages)
      .values({ ticketId, senderId: session.userId, senderRole: session.role, body: text, createdAt: sql`clock_timestamp()` })
      .returning()

    await tx
      .update(supportTickets)
      .set({
        status,
        lastMessageAt: now,
        lastMessageSenderId: session.userId,
        updatedAt: now,
        ...(isRequester ? { requesterReadAt: now } : { adminReadAt: now }),
        ...(claim ? { assignedTo: session.userId } : {}),
        ...(reopened ? { resolutionNotes: null } : {}),
      })
      .where(eq(supportTickets.id, ticketId))

    if (claim) {
      await recordAdminAction(tx, session.userId, 'TICKET_ASSIGNED', 'support_ticket', ticketId)
    }

    const viewer = isSupportStaff(session.role) ? 'STAFF' : 'REQUESTER'
    if (viewer === 'STAFF') {
      const view = await loadStaffTicket(tx, ticketId)
      const [sender] = await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1)
      return { message: toMessageView(inserted, ticket, viewer, sender?.name ?? null), ticket: view }
    }
    const [updated] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1)
    return { message: toMessageView(inserted, ticket, viewer, null), ticket: toRequesterView(updated) }
  })

  // After commit, never inside the transaction. Only the requester is
  // emailed; staff see requester messages in the queue.
  if (isStaffReply) {
    // `runInBackground` keeps the email alive past the response on Workers.
    runInBackground('support reply notification', () => notifySupportReply(ticketId))
  }

  return result
}

/**
 * Takes a ticket: the caller becomes its assignee. A NEW ticket moves to
 * ASSIGNED; an open ticket someone else holds keeps its status and changes
 * hands. Resolved and closed tickets can't be assigned. The assignee is
 * always the caller — there is no assigning on someone else's behalf.
 */
export async function assignTicket(ticketId: string, session: Session | null): Promise<StaffTicketView> {
  requireRole(session, [...STAFF_ROLES])

  return db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId)

    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      throw new Error(`Invalid ticket transition: ${ticket.status} -> ASSIGNED`)
    }

    if (ticket.assignedTo !== session.userId || ticket.status === 'NEW') {
      await tx
        .update(supportTickets)
        .set({
          assignedTo: session.userId,
          status: ticket.status === 'NEW' ? 'ASSIGNED' : ticket.status,
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, ticketId))
      await recordAdminAction(tx, session.userId, 'TICKET_ASSIGNED', 'support_ticket', ticketId)
    }

    return loadStaffTicket(tx, ticketId)
  })
}

/**
 * Staff status change, guarded by ALLOWED_TICKET_TRANSITIONS. ASSIGNED is
 * reached only through `assignTicket`. Resolving needs a resolution note (the
 * requester sees it) and is written to the admin action log every time;
 * reopening clears the old note. A ticket nobody owns yet is assigned to the
 * caller as it moves.
 */
export async function updateTicketStatus(
  ticketId: string,
  status: SupportStatus,
  resolutionNotes: string | undefined,
  session: Session | null,
): Promise<StaffTicketView> {
  requireRole(session, [...STAFF_ROLES])

  return db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId)

    if (status === 'ASSIGNED' || !canTransitionTicket(ticket.status, status)) {
      throw new Error(`Invalid ticket transition: ${ticket.status} -> ${status}`)
    }

    const notes =
      status === 'RESOLVED' ? requireText(resolutionNotes, 'A resolution note', SUPPORT_LIMITS.resolutionNotes) : undefined
    const reopened = ticket.status === 'RESOLVED' && status === 'IN_PROGRESS'

    await tx
      .update(supportTickets)
      .set({
        status,
        updatedAt: new Date(),
        ...(notes !== undefined ? { resolutionNotes: notes } : {}),
        ...(reopened ? { resolutionNotes: null } : {}),
        ...(ticket.assignedTo === null && status !== 'CLOSED' ? { assignedTo: session.userId } : {}),
      })
      .where(eq(supportTickets.id, ticketId))

    if (status === 'RESOLVED') {
      await recordAdminAction(tx, session.userId, 'TICKET_RESOLVED', 'support_ticket', ticketId, notes)
    }

    return loadStaffTicket(tx, ticketId)
  })
}
