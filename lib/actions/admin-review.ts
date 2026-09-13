'use server'

import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, organizerApplications, verificationLogs } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import { getSession } from '@/lib/auth/session'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import type { Mun, MunWithApplication } from '@/lib/types'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const
const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

export interface ReviewQueueParams {
  limit?: number
  offset?: number
}

export interface ReviewQueueResult {
  results: Mun[]
  total: number
}

/**
 * Muns awaiting ops/admin action, for the review queue dashboard. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN — actor is derived from `getSession()`, never
 * accepted as a parameter.
 *
 * Paginated (default 20/page) — this grows with total platform submission
 * volume, not per-mun, so it needs a bound before real organizer counts
 * (flagged during frontend review: unbounded at 500+ organizers would mean
 * a multi-thousand-row render on every /admin/review hit).
 */
export async function getReviewQueue(params: ReviewQueueParams = {}): Promise<ReviewQueueResult> {
  const session = await getSession()
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const whereClause = inArray(muns.status, ['SUBMITTED', 'UNDER_REVIEW'])

  const results = await db
    .select()
    .from(muns)
    .where(whereClause)
    .orderBy(desc(muns.createdAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(muns)
    .where(whereClause)

  return { results, total: count }
}

/**
 * Full ops-only detail for one mun: the mun row, its organizer application,
 * and its complete verification log history INCLUDING internalNotes — this
 * is the internal review view, unlike the public MUN detail page. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN.
 */
export async function getMunForReview(munId: string): Promise<MunWithApplication> {
  const session = await getSession()
  requireRole(session, [...REVIEW_ROLES])

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) {
    throw new Error('Mun not found')
  }

  const [application] = await db
    .select()
    .from(organizerApplications)
    .where(eq(organizerApplications.munId, munId))
    .limit(1)

  const logs = await db
    .select()
    .from(verificationLogs)
    .where(eq(verificationLogs.munId, munId))
    .orderBy(desc(verificationLogs.createdAt))

  return {
    ...mun,
    organizerApplication: application ?? null,
    verificationLogs: logs,
  }
}

/**
 * Records an ops/admin review decision on a mun, transitioning its status via
 * `transitionMun` (which validates the transition and writes the audit log
 * row). Requires OPERATIONS/ADMIN/SUPER_ADMIN.
 *
 * `getReviewQueue` surfaces muns in both SUBMITTED and UNDER_REVIEW — but the
 * lifecycle only allows a decision (APPROVED/REJECTED/CHANGES_REQUESTED) from
 * UNDER_REVIEW, not directly from SUBMITTED. Calling this on a SUBMITTED mun
 * therefore first claims it into UNDER_REVIEW (its own audit-logged
 * transition, actor = the deciding reviewer) before applying the decision, so
 * ops/admin can act on a queue row in one call instead of needing a separate
 * "claim" action.
 */
export async function reviewMunApplication(
  munId: string,
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
  notes?: string,
  internalNotes?: string,
): Promise<Mun> {
  const session = await getSession()
  requireRole(session, [...REVIEW_ROLES])

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) {
    throw new Error('Mun not found')
  }

  if (mun.status === 'SUBMITTED') {
    await transitionMun(munId, 'UNDER_REVIEW', session.userId)
  }

  return transitionMun(munId, decision, session.userId, notes, internalNotes)
}

/**
 * Publishes a mun (VERIFIED -> PUBLISHED). Stricter than review: only
 * ADMIN/SUPER_ADMIN — operations can review applications but only admin
 * publishes to the public marketplace.
 *
 * As of the verification/confirmation trust layer, this requires VERIFIED
 * (not VERIFICATION) — a mun only reaches VERIFIED once all 4 tracked
 * modules pass module-level review (see lib/lifecycle/module-verification.ts's
 * `checkAllModulesVerified`), which is a stricter bar than the old flat
 * mun-level VERIFICATION state.
 */
export async function publishMun(munId: string): Promise<Mun> {
  const session = await getSession()
  requireRole(session, [...PUBLISH_ROLES])

  return transitionMun(munId, 'PUBLISHED', session.userId)
}

export interface ModuleReviewQueueRow {
  id: string
  munId: string
  munName: string
  moduleName: string
  state: string
  organizerConfirmedAt: Date | null
}

export interface ModuleReviewQueueResult {
  results: ModuleReviewQueueRow[]
  total: number
}

/**
 * All PENDING_REVIEW module-verification rows across every mun, joined to
 * the mun's name, for the MUNHub Verification Console (PRD Section 15).
 * Requires OPERATIONS/ADMIN/SUPER_ADMIN.
 *
 * Paginated (default 20/page) — same reasoning as `getReviewQueue`: this
 * grows with total platform submission volume, not per-mun. Backed by
 * `mun_module_verifications_state_idx` (added alongside this change).
 */
export async function getModuleReviewQueue(params: ReviewQueueParams = {}): Promise<ModuleReviewQueueResult> {
  const session = await getSession()
  requireRole(session, [...REVIEW_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const whereClause = eq(munModuleVerifications.state, 'PENDING_REVIEW')

  const results = await db
    .select({
      id: munModuleVerifications.id,
      munId: munModuleVerifications.munId,
      munName: muns.name,
      moduleName: munModuleVerifications.moduleName,
      state: munModuleVerifications.state,
      organizerConfirmedAt: munModuleVerifications.organizerConfirmedAt,
    })
    .from(munModuleVerifications)
    .innerJoin(muns, eq(munModuleVerifications.munId, muns.id))
    .where(whereClause)
    .orderBy(desc(munModuleVerifications.organizerConfirmedAt))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(munModuleVerifications)
    .where(whereClause)

  return { results, total: count }
}
