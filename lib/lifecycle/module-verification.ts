import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munModuleVerifications, verificationIssues } from '@/lib/db/schema'
import type { MunModule, ModuleVerificationState, VerificationSeverity } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'
import { transitionMun } from './mun-state-machine'

const TRACKED_MODULES: MunModule[] = ['mun_details', 'committees', 'portfolios', 'registration_products']

async function assertOwnsOrAdmin(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return
  const [mun] = await db.select({ organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}

export interface ModuleVerification {
  id: string
  munId: string
  moduleName: MunModule
  state: ModuleVerificationState
  organizerConfirmedAt: Date | null
  lastReviewedAt: Date | null
  lastReviewedBy: string | null
}

/**
 * Returns the current verification state for a module on a mun, lazily
 * creating a NOT_SUBMITTED row if none exists yet — callers never have to
 * pre-seed rows for a newly created mun.
 */
export async function getModuleVerificationState(munId: string, moduleName: MunModule): Promise<ModuleVerification> {
  const [existing] = await db
    .select()
    .from(munModuleVerifications)
    .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, moduleName)))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(munModuleVerifications)
    .values({ munId, moduleName, state: 'NOT_SUBMITTED' })
    .returning()
  return created
}

/**
 * Organizer's per-module "I confirm..." statement (PRD Sections 5/6/8).
 * Owning organizer or admin only. Only legal from NOT_SUBMITTED or
 * CHANGES_REQUESTED — a module already PENDING_REVIEW/VERIFIED can't be
 * re-confirmed without a reviewer first sending it back.
 */
export async function confirmModule(munId: string, moduleName: MunModule, session: Session | null): Promise<ModuleVerification> {
  await assertOwnsOrAdmin(munId, session)

  const current = await getModuleVerificationState(munId, moduleName)
  if (current.state !== 'NOT_SUBMITTED' && current.state !== 'CHANGES_REQUESTED') {
    throw new Error(`Module "${moduleName}" cannot be confirmed from its current state (${current.state})`)
  }

  const [updated] = await db
    .update(munModuleVerifications)
    .set({ state: 'PENDING_REVIEW', organizerConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(munModuleVerifications.id, current.id))
    .returning()
  return updated
}

export interface IssueInput {
  severity: VerificationSeverity
  reason: string
  previousValue?: string
  newValue?: string
}

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

/**
 * MUNHub reviewer decision on a module (PRD Section 15). Records any issues
 * raised, flips the module's state, and — if the decision is VERIFIED —
 * checks whether all tracked modules are now VERIFIED and auto-advances the
 * mun to VERIFIED if so.
 */
export async function reviewModule(
  munId: string,
  moduleName: MunModule,
  decision: 'VERIFIED' | 'CHANGES_REQUESTED' | 'REJECTED',
  issues: IssueInput[],
  session: Session | null,
): Promise<ModuleVerification> {
  requireRole(session, [...REVIEW_ROLES])

  const current = await getModuleVerificationState(munId, moduleName)

  for (const issue of issues) {
    await db.insert(verificationIssues).values({
      munId,
      moduleName,
      severity: issue.severity,
      reason: issue.reason,
      previousValue: issue.previousValue,
      newValue: issue.newValue,
      raisedBy: session.userId,
    })
  }

  const [updated] = await db
    .update(munModuleVerifications)
    .set({ state: decision, lastReviewedAt: new Date(), lastReviewedBy: session.userId, updatedAt: new Date() })
    .where(eq(munModuleVerifications.id, current.id))
    .returning()

  if (decision === 'VERIFIED') {
    await checkAllModulesVerified(munId, session.userId)
  }

  return updated
}

/**
 * If all 4 tracked modules are VERIFIED and the mun is currently in
 * VERIFICATION, transitions it to VERIFIED via the shared state machine
 * (which writes the audit log row). `actorId` is the reviewer whose
 * `reviewModule` call triggered this check — `verificationLogs.reviewerId`
 * is a NOT NULL FK to a real user, so this can't be a synthetic "system"
 * actor.
 */
export async function checkAllModulesVerified(munId: string, actorId: string): Promise<boolean> {
  const rows = await db.select().from(munModuleVerifications).where(eq(munModuleVerifications.munId, munId))
  const rowsByModule = new Map(rows.map((r) => [r.moduleName, r]))

  const allVerified = TRACKED_MODULES.every((m) => rowsByModule.get(m)?.state === 'VERIFIED')
  if (!allVerified) return false

  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun || mun.status !== 'VERIFICATION') return false

  await transitionMun(munId, 'VERIFIED', actorId, 'All modules verified')
  return true
}
