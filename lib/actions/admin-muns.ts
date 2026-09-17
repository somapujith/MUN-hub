import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db/client'
import {
  adminActions,
  munModuleVerifications,
  munPaymentSettings,
  munSubmissions,
  muns,
  organizerApplications,
  registrations,
  users,
  verificationLogs,
} from '@/lib/db/schema'
import type {
  ModuleCompletionStatus,
  ModuleVerificationState,
  MunModule,
  MunStatus,
  PaymentVerificationState,
  RegistrationStatus,
  SubmissionStatus,
} from '@/lib/db/schema-enums'
import { registrationStatusEnum } from '@/lib/db/schema-enums'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { getGoLiveQueue, type GoLiveQueueParams, type GoLiveQueueRow } from '@/lib/lifecycle/go-live'
import { MODULE_REGISTRY } from '@/lib/lifecycle/module-registry'
import { computeSlaState, type SlaState } from '@/lib/lifecycle/sla'

// -----------------------------------------------------------------------------
// Conferences console — the staff-side list/detail of every MUN on the
// platform, whatever its status. Read-only: the actions on the detail page go
// through their existing endpoints (admin-review.ts publish/unpublish/
// suspend/reinstate, go-live.ts Gate 2 review, payment-settlement.ts
// verification, module-verification.ts requirement toggle, and the lifecycle
// endpoint). Readable by OPERATIONS/ADMIN/SUPER_ADMIN.
//
// Payment settings are read with an explicit column list that never includes
// the PAN/account-number ciphertext (same rule as payment-settlement.ts).
// -----------------------------------------------------------------------------

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

/** Registration statuses that hold a sold seat. */
const SEATED_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'ATTENDED', 'NO_SHOW']
/** Registration statuses still waiting on the delegate or the payment. */
const PENDING_STATUSES: RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING']

// Same predicate as go-live.ts / the partial unique index on mun_submissions.
const ACTIVE_SUBMISSION_STATUSES: SubmissionStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'QUEUED',
]

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

function statusList(statuses: RegistrationStatus[]) {
  return sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface AdminMunListParams {
  q?: string
  status?: MunStatus
  limit?: number
  offset?: number
}

export interface AdminMunListRow {
  id: string
  name: string
  slug: string
  status: MunStatus
  startDate: Date | null
  endDate: Date | null
  city: string | null
  country: string | null
  createdAt: Date
  organizerId: string
  organizerName: string
  organizerEmail: string
  seatedRegistrations: number
  pendingRegistrations: number
}

export interface AdminMunListResult {
  results: AdminMunListRow[]
  total: number
}

/**
 * Every MUN on the platform, newest first, paginated (default 20). `q`
 * matches MUN name, slug, organizer name or organizer email (case-insensitive
 * substring); `status` narrows to one lifecycle status. Registration counts
 * are per-row subqueries, which stay cheap because a page is at most 100 rows
 * and registrations are indexed on (mun_id, status).
 */
export async function listAdminMuns(
  params: AdminMunListParams = {},
  session: Session | null,
): Promise<AdminMunListResult> {
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const q = params.q?.trim()
  const pattern = q ? `%${escapeLike(q)}%` : undefined
  const whereClause = and(
    params.status ? eq(muns.status, params.status) : undefined,
    pattern
      ? or(ilike(muns.name, pattern), ilike(muns.slug, pattern), ilike(users.name, pattern), ilike(users.email, pattern))
      : undefined,
  )

  const results = await db
    .select({
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      status: muns.status,
      startDate: muns.startDate,
      endDate: muns.endDate,
      city: muns.city,
      country: muns.country,
      createdAt: muns.createdAt,
      organizerId: users.id,
      organizerName: users.name,
      organizerEmail: users.email,
      seatedRegistrations: sql<number>`(
        select count(*)::int from ${registrations}
        where ${registrations.munId} = ${muns.id} and ${registrations.status} in (${statusList(SEATED_STATUSES)})
      )`,
      pendingRegistrations: sql<number>`(
        select count(*)::int from ${registrations}
        where ${registrations.munId} = ${muns.id} and ${registrations.status} in (${statusList(PENDING_STATUSES)})
      )`,
    })
    .from(muns)
    .innerJoin(users, eq(muns.organizerId, users.id))
    .where(whereClause)
    .orderBy(desc(muns.createdAt), desc(muns.id))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(muns)
    .innerJoin(users, eq(muns.organizerId, users.id))
    .where(whereClause)

  return { results, total: count }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface AdminMunModuleRow {
  moduleName: MunModule
  label: string
  isRequired: boolean
  /** Reviewer-facing axis. */
  state: ModuleVerificationState
  /** Organizer-facing axis. */
  completionStatus: ModuleCompletionStatus
  completionPercentage: number
  blockingIssueCount: number
  lastReviewedAt: Date | null
  lastReviewedByName: string | null
}

export interface AdminMunSubmissionSummary {
  id: string
  status: SubmissionStatus
  active: boolean
  versionNumber: number
  submittedAt: Date | null
  reviewStartedAt: Date | null
  decidedAt: Date | null
  queuedAt: Date | null
  publishedAt: Date | null
  slaDeadline: Date
  /** Computed on read, like the go-live queue — never the stored snapshot. */
  slaState: SlaState
  reviewerId: string | null
  reviewerName: string | null
  rejectionReason: string | null
}

export interface AdminPaymentSettingsSummary {
  verificationState: PaymentVerificationState
  verifiedAt: Date | null
  verifiedByName: string | null
  updatedAt: Date
}

export interface AdminMunHistoryEntry {
  id: string
  source: 'lifecycle' | 'admin_action'
  action: string
  actorId: string
  actorName: string | null
  notes: string | null
  /** Ops-only notes from a lifecycle transition; never shown to organizers. */
  internalNotes: string | null
  createdAt: Date
}

export interface AdminMunDetail {
  mun: {
    id: string
    name: string
    slug: string
    edition: string | null
    status: MunStatus
    city: string | null
    country: string | null
    venue: string | null
    startDate: Date | null
    endDate: Date | null
    registrationOpensAt: Date | null
    registrationDeadline: Date | null
    publishedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }
  organizer: { id: string; name: string; email: string; suspended: boolean }
  application: { status: string; submittedAt: Date; reviewNotes: string | null } | null
  registrationCounts: Record<RegistrationStatus, number>
  modules: AdminMunModuleRow[]
  /** The most recent submission (active or not), or null if the MUN was never submitted. */
  submission: AdminMunSubmissionSummary | null
  /** Null until the organizer has submitted payment settlement details. */
  paymentSettings: AdminPaymentSettingsSummary | null
  /** Newest first, at most `HISTORY_LIMIT` entries. */
  history: AdminMunHistoryEntry[]
}

const HISTORY_LIMIT = 100

const reviewers = alias(users, 'reviewers')

/**
 * Full staff view of one MUN: status, organizer, Gate 1 application, seat
 * counts, the 15 tracked modules (registry order, with defaults for modules
 * that have no row yet), the latest Gate 2 submission, payment-account
 * verification state, and a merged history of lifecycle transitions and
 * admin actions that reference this MUN. Throws 'Mun not found'.
 */
export async function getAdminMunDetail(munId: string, session: Session | null): Promise<AdminMunDetail> {
  requireRole(session, [...REVIEW_ROLES])

  const [row] = await db
    .select({
      mun: {
        id: muns.id,
        name: muns.name,
        slug: muns.slug,
        edition: muns.edition,
        status: muns.status,
        city: muns.city,
        country: muns.country,
        venue: muns.venue,
        startDate: muns.startDate,
        endDate: muns.endDate,
        registrationOpensAt: muns.registrationOpensAt,
        registrationDeadline: muns.registrationDeadline,
        publishedAt: muns.publishedAt,
        createdAt: muns.createdAt,
        updatedAt: muns.updatedAt,
      },
      organizer: { id: users.id, name: users.name, email: users.email, suspended: users.suspended },
    })
    .from(muns)
    .innerJoin(users, eq(muns.organizerId, users.id))
    .where(eq(muns.id, munId))
    .limit(1)
  if (!row) throw new Error('Mun not found')

  const [application, statusCounts, moduleRows, latestSubmission, paymentSettings, lifecycleRows, actionRows] =
    await Promise.all([
      db
        .select({
          status: organizerApplications.status,
          submittedAt: organizerApplications.submittedAt,
          reviewNotes: organizerApplications.reviewNotes,
        })
        .from(organizerApplications)
        .where(eq(organizerApplications.munId, munId))
        .limit(1),
      db
        .select({ status: registrations.status, count: sql<number>`count(*)::int` })
        .from(registrations)
        .where(eq(registrations.munId, munId))
        .groupBy(registrations.status),
      db
        .select({
          moduleName: munModuleVerifications.moduleName,
          isRequired: munModuleVerifications.isRequired,
          state: munModuleVerifications.state,
          completionStatus: munModuleVerifications.completionStatus,
          completionPercentage: munModuleVerifications.completionPercentage,
          blockingIssueCount: munModuleVerifications.blockingIssueCount,
          lastReviewedAt: munModuleVerifications.lastReviewedAt,
          lastReviewedByName: reviewers.name,
        })
        .from(munModuleVerifications)
        .leftJoin(reviewers, eq(munModuleVerifications.lastReviewedBy, reviewers.id))
        .where(eq(munModuleVerifications.munId, munId)),
      db
        .select({
          id: munSubmissions.id,
          status: munSubmissions.status,
          versionNumber: munSubmissions.versionNumber,
          submittedAt: munSubmissions.submittedAt,
          reviewStartedAt: munSubmissions.reviewStartedAt,
          decidedAt: munSubmissions.decidedAt,
          queuedAt: munSubmissions.queuedAt,
          publishedAt: munSubmissions.publishedAt,
          slaDeadline: munSubmissions.slaDeadline,
          slaPausedAt: munSubmissions.slaPausedAt,
          slaPausedTotalMs: munSubmissions.slaPausedTotalMs,
          reviewerId: munSubmissions.reviewerId,
          reviewerName: reviewers.name,
          rejectionReason: munSubmissions.rejectionReason,
        })
        .from(munSubmissions)
        .leftJoin(reviewers, eq(munSubmissions.reviewerId, reviewers.id))
        .where(eq(munSubmissions.munId, munId))
        .orderBy(desc(munSubmissions.versionNumber), desc(munSubmissions.createdAt))
        .limit(1),
      db
        .select({
          verificationState: munPaymentSettings.verificationState,
          verifiedAt: munPaymentSettings.verifiedAt,
          verifiedByName: reviewers.name,
          updatedAt: munPaymentSettings.updatedAt,
        })
        .from(munPaymentSettings)
        .leftJoin(reviewers, eq(munPaymentSettings.verifiedBy, reviewers.id))
        .where(eq(munPaymentSettings.munId, munId))
        .limit(1),
      db
        .select({
          id: verificationLogs.id,
          action: verificationLogs.action,
          actorId: verificationLogs.reviewerId,
          actorName: reviewers.name,
          notes: verificationLogs.notes,
          internalNotes: verificationLogs.internalNotes,
          createdAt: verificationLogs.createdAt,
        })
        .from(verificationLogs)
        .leftJoin(reviewers, eq(verificationLogs.reviewerId, reviewers.id))
        .where(eq(verificationLogs.munId, munId))
        .orderBy(desc(verificationLogs.createdAt))
        .limit(HISTORY_LIMIT),
      db
        .select({
          id: adminActions.id,
          action: sql<string>`coalesce(${adminActions.metadata}->>'event', ${adminActions.action}::text)`,
          actorId: adminActions.actorId,
          actorName: reviewers.name,
          notes: adminActions.reason,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions)
        .leftJoin(reviewers, eq(adminActions.actorId, reviewers.id))
        .where(
          or(
            and(inArray(adminActions.targetType, ['mun', 'mun_payment_settings']), eq(adminActions.targetId, munId)),
            sql`${adminActions.metadata}->>'munId' = ${munId}`,
          ),
        )
        .orderBy(desc(adminActions.createdAt))
        .limit(HISTORY_LIMIT),
    ])

  const registrationCounts = Object.fromEntries(
    registrationStatusEnum.enumValues.map((status) => [status, 0]),
  ) as Record<RegistrationStatus, number>
  for (const { status, count } of statusCounts) registrationCounts[status] = count

  const moduleByKey = new Map(moduleRows.map((module) => [module.moduleName, module]))
  const modules: AdminMunModuleRow[] = MODULE_REGISTRY.map((definition) => {
    const stored = moduleByKey.get(definition.key)
    return {
      moduleName: definition.key,
      label: definition.label,
      isRequired: stored?.isRequired ?? definition.defaultRequired,
      state: stored?.state ?? 'NOT_SUBMITTED',
      completionStatus: stored?.completionStatus ?? 'NOT_STARTED',
      completionPercentage: stored?.completionPercentage ?? 0,
      blockingIssueCount: stored?.blockingIssueCount ?? 0,
      lastReviewedAt: stored?.lastReviewedAt ?? null,
      lastReviewedByName: stored?.lastReviewedByName ?? null,
    }
  })

  const now = new Date()
  const [submissionRow] = latestSubmission
  const submission: AdminMunSubmissionSummary | null = submissionRow
    ? {
        id: submissionRow.id,
        status: submissionRow.status,
        active: ACTIVE_SUBMISSION_STATUSES.includes(submissionRow.status),
        versionNumber: submissionRow.versionNumber,
        submittedAt: submissionRow.submittedAt,
        reviewStartedAt: submissionRow.reviewStartedAt,
        decidedAt: submissionRow.decidedAt,
        queuedAt: submissionRow.queuedAt,
        publishedAt: submissionRow.publishedAt,
        slaDeadline: submissionRow.slaDeadline,
        slaState: computeSlaState(
          {
            slaDeadline: submissionRow.slaDeadline,
            status: submissionRow.status,
            slaPausedAt: submissionRow.slaPausedAt,
            slaPausedTotalMs: submissionRow.slaPausedTotalMs,
            completedStatuses: ['PUBLISHED', 'REJECTED', 'WITHDRAWN'],
          },
          now,
          submissionRow.submittedAt ?? undefined,
        ),
        reviewerId: submissionRow.reviewerId,
        reviewerName: submissionRow.reviewerName,
        rejectionReason: submissionRow.rejectionReason,
      }
    : null

  const history: AdminMunHistoryEntry[] = [
    ...lifecycleRows.map((entry) => ({ ...entry, source: 'lifecycle' as const })),
    ...actionRows.map((entry) => ({ ...entry, internalNotes: null, source: 'admin_action' as const })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, HISTORY_LIMIT)

  return {
    mun: row.mun,
    organizer: row.organizer,
    application: application[0] ?? null,
    registrationCounts,
    modules,
    submission,
    paymentSettings: paymentSettings[0] ?? null,
    history,
  }
}

// ---------------------------------------------------------------------------
// Go-live queue, with the reviewer and payment-account state per row
// ---------------------------------------------------------------------------

export interface GoLiveQueueDetailRow extends GoLiveQueueRow {
  organizerName: string
  reviewerId: string | null
  reviewerName: string | null
  /** Null when the organizer hasn't submitted payment settlement details yet. */
  paymentVerificationState: PaymentVerificationState | null
}

export interface GoLiveQueueDetailResult {
  results: GoLiveQueueDetailRow[]
  total: number
}

/**
 * `getGoLiveQueue` (lib/lifecycle/go-live.ts) plus what the admin queue page
 * needs to act on each row: who is reviewing the submission and whether the
 * MUN's payment account is verified (a publish blocker). One extra query for
 * the page's rows; the queue's own ordering, paging and computed SLA state are
 * reused unchanged.
 */
export async function getGoLiveQueueDetails(
  params: GoLiveQueueParams = {},
  session: Session | null,
): Promise<GoLiveQueueDetailResult> {
  requireRole(session, [...REVIEW_ROLES])

  const queue = await getGoLiveQueue(params, session)
  if (queue.results.length === 0) return { results: [], total: queue.total }

  const extras = await db
    .select({
      submissionId: munSubmissions.id,
      organizerName: users.name,
      reviewerId: munSubmissions.reviewerId,
      reviewerName: reviewers.name,
      paymentVerificationState: munPaymentSettings.verificationState,
    })
    .from(munSubmissions)
    .innerJoin(muns, eq(munSubmissions.munId, muns.id))
    .innerJoin(users, eq(muns.organizerId, users.id))
    .leftJoin(reviewers, eq(munSubmissions.reviewerId, reviewers.id))
    .leftJoin(munPaymentSettings, eq(munPaymentSettings.munId, munSubmissions.munId))
    .where(
      inArray(
        munSubmissions.id,
        queue.results.map((result) => result.submissionId),
      ),
    )
    .orderBy(asc(munSubmissions.id))

  const bySubmission = new Map(extras.map((extra) => [extra.submissionId, extra]))

  return {
    total: queue.total,
    results: queue.results.map((result) => {
      const extra = bySubmission.get(result.submissionId)
      return {
        ...result,
        organizerName: extra?.organizerName ?? '',
        reviewerId: extra?.reviewerId ?? null,
        reviewerName: extra?.reviewerName ?? null,
        paymentVerificationState: extra?.paymentVerificationState ?? null,
      }
    }),
  }
}
