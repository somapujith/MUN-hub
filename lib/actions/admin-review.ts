'use server'

import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, verificationLogs } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import { getSession } from '@/lib/auth/session'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import type { Mun, MunWithApplication } from '@/lib/types'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const
const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

/**
 * Muns awaiting ops/admin action, for the review queue dashboard. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN — actor is derived from `getSession()`, never
 * accepted as a parameter.
 */
export async function getReviewQueue(): Promise<Mun[]> {
  const session = await getSession()
  requireRole(session, [...REVIEW_ROLES])

  return db
    .select()
    .from(muns)
    .where(inArray(muns.status, ['SUBMITTED', 'UNDER_REVIEW']))
    .orderBy(desc(muns.createdAt))
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
 * Publishes a mun (VERIFICATION -> PUBLISHED). Stricter than review: only
 * ADMIN/SUPER_ADMIN — operations can review applications but only admin
 * publishes to the public marketplace.
 */
export async function publishMun(munId: string): Promise<Mun> {
  const session = await getSession()
  requireRole(session, [...PUBLISH_ROLES])

  return transitionMun(munId, 'PUBLISHED', session.userId)
}
