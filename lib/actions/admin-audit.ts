import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { getGoLiveQueue } from '@/lib/lifecycle/go-live'
import { getModuleReviewQueue, getReviewQueue } from './admin-review'
import { listPaymentExceptions } from './admin-search'
import { listTickets } from './support'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

// ---------------------------------------------------------------------------
// Overview stats — the /admin dashboard's queue-depth cards
// ---------------------------------------------------------------------------

export interface AdminOverviewStats {
  pendingApplications: number
  pendingModuleReviews: number
  openSupportTickets: number
  paymentExceptions: number
  goLiveQueue: number
}

// listTickets only filters on one exact status, and a ticket is "open" for
// this card if it hasn't reached a terminal state (RESOLVED/CLOSED) yet —
// mirrors ALLOWED_TICKET_TRANSITIONS in support.ts, where those two are the
// only states with no further forward transition.
const OPEN_TICKET_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING'] as const

/**
 * One aggregate read for the /admin overview dashboard cards. Composes the
 * existing per-queue actions (getReviewQueue, getModuleReviewQueue,
 * listTickets, listPaymentExceptions, getGoLiveQueue) rather than
 * duplicating any of their query logic — this function owns none of the
 * underlying queries, only the fan-out + count reduction. `limit: 1` on the
 * paginated queue reads is just an optimization (we only ever read
 * `.total`); each one still runs a full unfiltered COUNT(*) query.
 */
export async function getAdminOverviewStats(session: Session | null): Promise<AdminOverviewStats> {
  requireRole(session, [...ADMIN_ROLES])

  const [reviewQueue, moduleQueue, tickets, paymentExceptions, goLiveQueue] = await Promise.all([
    getReviewQueue({ limit: 1 }, session),
    getModuleReviewQueue({ limit: 1 }, session),
    listTickets({}, session),
    listPaymentExceptions(session),
    getGoLiveQueue({ limit: 1 }, session),
  ])

  const openSupportTickets = tickets.filter((ticket) =>
    (OPEN_TICKET_STATUSES as readonly string[]).includes(ticket.status),
  ).length

  return {
    pendingApplications: reviewQueue.total,
    pendingModuleReviews: moduleQueue.total,
    openSupportTickets,
    paymentExceptions: paymentExceptions.length,
    goLiveQueue: goLiveQueue.total,
  }
}

// ---------------------------------------------------------------------------
// Global audit-log feed — the /admin/audit list page
// ---------------------------------------------------------------------------

export interface AdminAuditListItem {
  id: string
  actorId: string
  actorName: string
  action: string
  targetType: string
  targetId: string
  reason: string | null
  createdAt: Date
}

export interface AdminAuditListParams {
  limit?: number
  offset?: number
}

export interface AdminAuditListResult {
  results: AdminAuditListItem[]
  total: number
}

/**
 * Cross-target `admin_actions` feed, newest first — distinct from
 * `getAuditHistory` (lib/actions/audit-history.ts), which merges
 * admin_actions + verification_logs for ONE (targetType, targetId) pair.
 * This is the platform-wide list that a reviewer clicks through from to
 * reach that per-target detail view. Paginated for the same reason as
 * getReviewQueue/getModuleReviewQueue/getGoLiveQueue: this table is
 * append-only and grows without bound as the platform runs. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN, same bar as every other admin-facing read.
 */
export async function listAdminActions(
  params: AdminAuditListParams = {},
  session: Session | null,
): Promise<AdminAuditListResult> {
  requireRole(session, [...ADMIN_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0

  const results = await db
    .select({
      id: adminActions.id,
      actorId: adminActions.actorId,
      actorName: users.name,
      action: adminActions.action,
      targetType: adminActions.targetType,
      targetId: adminActions.targetId,
      reason: adminActions.reason,
      createdAt: adminActions.createdAt,
    })
    .from(adminActions)
    .innerJoin(users, eq(adminActions.actorId, users.id))
    .orderBy(desc(adminActions.createdAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminActions)

  return { results, total: count }
}
