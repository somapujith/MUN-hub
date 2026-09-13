'use server'

import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportTickets } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import type { SupportCategory, SupportPriority, SupportStatus } from '@/lib/db/schema-enums'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

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
 * intentionally unpaginated (`filters?: {status}` -> full array) to match
 * the stub Task 8's admin-overview dashboard is building against
 * concurrently in a separate worktree; do not add required params or change
 * the shape without updating that consumer too.
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

/** Assigns a ticket to an admin/ops user and moves it to ASSIGNED. Logs TICKET_ASSIGNED. */
export async function assignTicket(ticketId: string, assigneeId: string): Promise<SupportTicketRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(supportTickets)
      .set({ assignedTo: assigneeId, status: 'ASSIGNED', updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId))
      .returning()

    await recordAdminAction(tx, session.userId, 'TICKET_ASSIGNED', 'support_ticket', ticketId)

    return updated
  })
}

/**
 * Transitions a ticket's status (e.g. IN_PROGRESS/WAITING/RESOLVED/CLOSED).
 * Only RESOLVED writes an admin_actions row (TICKET_RESOLVED) — that's the
 * only status transition in `adminActionEnum`; other transitions are
 * ordinary queue management and don't need an audit entry.
 */
export async function updateTicketStatus(
  ticketId: string,
  status: SupportStatus,
  resolutionNotes?: string,
): Promise<SupportTicketRow> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  return db.transaction(async (tx) => {
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
