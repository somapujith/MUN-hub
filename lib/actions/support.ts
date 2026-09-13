'use server'

import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportTickets } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import type { SupportCategory, SupportPriority, SupportStatus } from '@/lib/db/schema-enums'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

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
 * is always derived from `getSession()` — never accept a client-supplied
 * `createdBy`, same rule as every other actor-scoped action in this codebase.
 */
export async function createTicket(input: CreateTicketInput): Promise<SupportTicketRow> {
  const session = await getSession()
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
export async function listTickets(filters: { status?: SupportStatus } = {}): Promise<SupportTicketRow[]> {
  const session = await getSession()
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

/**
 * Self-assigns a ticket to the acting session and moves it to ASSIGNED. Logs
 * TICKET_ASSIGNED. The assignee is always `session.userId` — never a
 * client-supplied id — matching the UI, which only ever offers an "assign to
 * me" action (see `app/admin/support/ticket-row.tsx`; there is no picker for
 * assigning to a different admin). Accepting an arbitrary `assigneeId`
 * parameter here would let any caller reaching this action assign a ticket
 * to a third party it never authenticated as.
 */
export async function assignTicket(ticketId: string): Promise<SupportTicketRow> {
  const session = await getSession()
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
  resolutionNotes?: string,
): Promise<SupportTicketRow> {
  const session = await getSession()
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
