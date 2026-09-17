import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'
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
  /** MUNs whose conference results are waiting for a MUNHub decision (RESULTS_UNDER_REVIEW). */
  resultsReview: number
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
 * duplicating any of their query logic — this function owns only the fan-out,
 * the count reduction, and the results-review count (a plain status count;
 * there is no results queue action). `limit: 1` on the
 * paginated queue reads is just an optimization (we only ever read
 * `.total`); each one still runs a full unfiltered COUNT(*) query.
 */
export async function getAdminOverviewStats(session: Session | null): Promise<AdminOverviewStats> {
  requireRole(session, [...ADMIN_ROLES])

  const [reviewQueue, moduleQueue, tickets, paymentExceptions, goLiveQueue, resultsReview] = await Promise.all([
    getReviewQueue({ limit: 1 }, session),
    getModuleReviewQueue({ limit: 1 }, session),
    listTickets({}, session),
    listPaymentExceptions(session),
    getGoLiveQueue({ limit: 1 }, session),
    db.$count(muns, eq(muns.status, 'RESULTS_UNDER_REVIEW')),
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
    resultsReview,
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
  /**
   * Include PII_READ rows (staff reads of delegate data, one per list page
   * load). Off by default so they don't bury the changes in the feed.
   */
  includeDataAccess?: boolean
}

export interface AdminAuditListResult {
  results: AdminAuditListItem[]
  total: number
}

/** Gate 1 decisions as they appear in the platform feed (`APPLICATION_` + the mun status). */
export const GATE1_AUDIT_ACTIONS = [
  'APPLICATION_APPROVED',
  'APPLICATION_REJECTED',
  'APPLICATION_CHANGES_REQUESTED',
] as const

/**
 * Platform-wide audit feed, newest first — distinct from `getAuditHistory`
 * (lib/actions/audit-history.ts), which merges admin_actions +
 * verification_logs for ONE (targetType, targetId) pair. This is the list a
 * reviewer clicks through from to reach that per-target detail view.
 *
 * Two sources:
 * - every `admin_actions` row (suspensions, Gate 2 decisions, publishes, …),
 *   labelled with `metadata.event` when the row carries one. Staff-management
 *   writes (admin-staff.ts) store the closest existing enum value and put the
 *   precise event name (STAFF_CREATED, STAFF_ROLE_CHANGED, …) there;
 * - Gate 1 organizer-application decisions (`reviewMunApplication`), which
 *   are recorded only as `verification_logs` transitions. A row counts as a
 *   Gate 1 decision when it is APPROVED/REJECTED/CHANGES_REQUESTED and the
 *   mun's immediately preceding log row is UNDER_REVIEW — UNDER_REVIEW is a
 *   Gate 1-only status and the only state those decisions can leave from, so
 *   a Gate 2 REJECTED/CHANGES_REQUESTED (which leaves from VERIFICATION, and
 *   already has its own MUN_* admin_actions row) is never picked up twice.
 *   These are labelled `APPLICATION_<decision>` so they can't be mistaken for
 *   Gate 2's MUN_APPROVED/MUN_REJECTED/MUN_CHANGES_REQUESTED.
 *
 * PII_READ rows are left out unless `includeDataAccess` is set.
 *
 * Paginated for the same reason as getReviewQueue/getModuleReviewQueue/
 * getGoLiveQueue: both sources are append-only and grow without bound.
 * Requires OPERATIONS/ADMIN/SUPER_ADMIN, same bar as every other admin read.
 */
export async function listAdminActions(
  params: AdminAuditListParams = {},
  session: Session | null,
): Promise<AdminAuditListResult> {
  requireRole(session, [...ADMIN_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0

  const feed = sql`
    SELECT aa.id, aa.actor_id, COALESCE(aa.metadata->>'event', aa.action::text) AS action,
      aa.target_type, aa.target_id, aa.reason, aa.created_at
    FROM admin_actions aa
    ${params.includeDataAccess ? sql`` : sql`WHERE aa.action <> 'PII_READ'`}
    UNION ALL
    SELECT vl.id, vl.reviewer_id, 'APPLICATION_' || vl.action, 'mun', vl.mun_id, vl.notes, vl.created_at
    FROM verification_logs vl
    WHERE vl.action IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')
      AND (
        SELECT prev.action
        FROM verification_logs prev
        WHERE prev.mun_id = vl.mun_id
          AND (prev.created_at, prev.id) < (vl.created_at, vl.id)
        ORDER BY prev.created_at DESC, prev.id DESC
        LIMIT 1
      ) = 'UNDER_REVIEW'
  `

  const rows = await db.execute<{
    id: string
    actor_id: string
    actor_name: string
    action: string
    target_type: string
    target_id: string
    reason: string | null
    created_at: string | Date
  }>(sql`
    SELECT feed.*, u.name AS actor_name
    FROM (${feed}) AS feed
    INNER JOIN ${users} u ON u.id = feed.actor_id
    ORDER BY feed.created_at DESC, feed.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countRows = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM (${feed}) AS feed INNER JOIN ${users} u ON u.id = feed.actor_id`,
  )

  const results: AdminAuditListItem[] = Array.from(rows).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }))

  return { results, total: Number(Array.from(countRows)[0]?.count ?? 0) }
}
