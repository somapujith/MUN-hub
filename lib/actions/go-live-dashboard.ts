import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  munSubmissions,
  muns,
  organizerApplications,
  users,
  verificationIssues,
  verificationLogs,
} from '@/lib/db/schema'
import type { ApplicationStatus, MunModule, VerificationSeverity } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { getModuleDefinition } from '@/lib/lifecycle/module-registry'
import { recomputeMunProgress } from '@/lib/lifecycle/module-completion'
import { PRD_STATE_ALIASES } from '@/lib/lifecycle/mun-state-machine'
import { ORGANIZER_ATTESTATION, buildSnapshot } from '@/lib/lifecycle/organizer-confirmation'
import { loadValidationContext, type ValidationCheck } from '@/lib/lifecycle/validation'

// -----------------------------------------------------------------------------
// go-live-dashboard — organizer-facing "Get Your MUN Live" read (design doc
// Section 3.2, task brief Step 2)
// -----------------------------------------------------------------------------
//
// This is a DASHBOARD READ, not a gate: it reports the same materialized
// progress columns `onModuleDataChanged` keeps up to date, it does not
// itself decide whether a mun may submit or publish (that's
// `validateMunForSubmission` / `publishFromQueue`, Tasks 9-10). Mirrors the
// existing MunDetail (public/organizer-safe) vs MunWithApplication
// (ops-only, carries internalNotes) split in lib/types/mun.ts — this type
// must never carry anything ops-only either.

export interface ModuleProgressSummary {
  key: string
  label: string
  isRequired: boolean
  completionStatus: string
  completionPercentage: number
  /** The OTHER axis — reviewer-facing verification state (NOT_SUBMITTED/PENDING_REVIEW/VERIFIED/CHANGES_REQUESTED/REJECTED). */
  verificationState: string
  blockingIssueCount: number
  /** Every check the module's validator ran, passing and failing, for the organizer's checklist. */
  checks: ValidationCheck[]
}

export interface MunGoLiveProgress {
  munId: string
  lifecycleStatus: string
  /** PRD Section 4's Gate-2 display label for `lifecycleStatus`, or the raw status if no alias exists (see PRD_STATE_ALIASES). */
  lifecycleStatusLabel: string
  overallPercentage: number
  requiredTotal: number
  requiredComplete: number
  blockingIssueCount: number
  modules: ModuleProgressSummary[]
  /**
   * The current submission summary, or null. There is no `mun_submissions`
   * table yet (Task 10 adds it) — always null until then.
   */
  submission: null
}

/**
 * Returns the go-live progress dashboard for one mun. Callable by the owning
 * organizer or OPERATIONS/ADMIN/SUPER_ADMIN (`assertOwnsOrAdmin` covers both:
 * it early-returns for ADMIN/SUPER_ADMIN and separately allows the owning
 * organizer — see lib/auth/ownership.ts). Throws `Error('Forbidden')` for
 * anyone else, `Error('Mun not found')` for a bad munId.
 *
 * NOTE: `assertOwnsOrAdmin` currently allows ADMIN/SUPER_ADMIN but not
 * OPERATIONS by itself — OPERATIONS access for this read is granted below by
 * checking the role directly first, matching the brief's "owning organizer
 * or OPERATIONS/ADMIN/SUPER_ADMIN" requirement without having to widen the
 * shared ownership helper's semantics for every other caller.
 */
export async function getMunProgress(munId: string, session: Session | null): Promise<MunGoLiveProgress> {
  if (!session) throw new Error('Forbidden')

  if (session.role === 'OPERATIONS' || session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') {
    const [mun] = await db.select({ id: muns.id }).from(muns).where(eq(muns.id, munId)).limit(1)
    if (!mun) throw new Error('Mun not found')
  } else {
    await assertOwnsOrAdmin(munId, session)
  }

  const progress = await recomputeMunProgress(munId)
  const context = await loadValidationContext(munId)

  const modules: ModuleProgressSummary[] = progress.modules.map((m) => {
    const definition = getModuleDefinition(m.key)
    return {
      key: m.key,
      label: definition.label,
      isRequired: m.isRequired,
      completionStatus: m.completionStatus,
      completionPercentage: m.completionPercentage,
      verificationState: m.verificationState,
      blockingIssueCount: m.blockingIssueCount,
      checks: definition.validate(context).checks,
    }
  })

  return {
    munId,
    lifecycleStatus: progress.lifecycleStatus,
    lifecycleStatusLabel: PRD_STATE_ALIASES[progress.lifecycleStatus] ?? progress.lifecycleStatus,
    overallPercentage: progress.overallPercentage,
    requiredTotal: progress.requiredTotal,
    requiredComplete: progress.requiredComplete,
    blockingIssueCount: progress.blockingIssueCount,
    modules,
    submission: null,
  }
}

const STAFF_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

/** Owning organizer, or any staff reviewer. Same gate as `getMunProgress`. */
async function assertCanReadMunReview(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if ((STAFF_ROLES as readonly string[]).includes(session.role)) {
    const [mun] = await db.select({ id: muns.id }).from(muns).where(eq(muns.id, munId)).limit(1)
    if (!mun) throw new Error('Mun not found')
    return
  }
  await assertOwnsOrAdmin(munId, session)
}

export interface MunReviewFeedback {
  /** Gate 1: the organizer application for this mun. */
  application: { status: ApplicationStatus; reviewNotes: string | null; submittedAt: Date } | null
  /**
   * Gate 2: the latest content-review submission round. `rejectionReason` is
   * left out on purpose: `reviewSubmission` files it as an internal note.
   */
  submission: {
    status: string
    versionNumber: number
    submittedAt: Date | null
    decidedAt: Date | null
  } | null
  /** Notes staff attached to status changes, newest first. Internal notes are never included. */
  reviewerNotes: { id: string; status: string; notes: string; createdAt: Date }[]
  /** Issues reviewers raised, newest first. Automated check results are in `getMunProgress` instead. */
  issues: {
    id: string
    moduleName: MunModule
    moduleLabel: string
    severity: VerificationSeverity
    reason: string
    resolved: boolean
    createdAt: Date
  }[]
}

/**
 * Everything MUN Hub reviewers have told the organizer about this mun, across
 * Gate 1 (application) and Gate 2 (content review). Owning organizer or staff.
 */
export async function getMunReviewFeedback(munId: string, session: Session | null): Promise<MunReviewFeedback> {
  await assertCanReadMunReview(munId, session)

  const [application] = await db
    .select({
      status: organizerApplications.status,
      reviewNotes: organizerApplications.reviewNotes,
      submittedAt: organizerApplications.submittedAt,
    })
    .from(organizerApplications)
    .where(eq(organizerApplications.munId, munId))
    .limit(1)

  const [submission] = await db
    .select({
      status: munSubmissions.status,
      versionNumber: munSubmissions.versionNumber,
      submittedAt: munSubmissions.submittedAt,
      decidedAt: munSubmissions.decidedAt,
    })
    .from(munSubmissions)
    .where(eq(munSubmissions.munId, munId))
    .orderBy(desc(munSubmissions.versionNumber))
    .limit(1)

  const reviewerNotes = await db
    .select({
      id: verificationLogs.id,
      status: verificationLogs.action,
      notes: verificationLogs.notes,
      createdAt: verificationLogs.createdAt,
    })
    .from(verificationLogs)
    .innerJoin(users, eq(users.id, verificationLogs.reviewerId))
    .where(
      and(
        eq(verificationLogs.munId, munId),
        isNotNull(verificationLogs.notes),
        ne(verificationLogs.notes, ''),
        inArray(users.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(desc(verificationLogs.createdAt))

  const issueRows = await db
    .select({
      id: verificationIssues.id,
      moduleName: verificationIssues.moduleName,
      severity: verificationIssues.severity,
      reason: verificationIssues.reason,
      resolved: verificationIssues.resolved,
      createdAt: verificationIssues.createdAt,
    })
    .from(verificationIssues)
    .where(and(eq(verificationIssues.munId, munId), eq(verificationIssues.source, 'REVIEWER')))
    .orderBy(desc(verificationIssues.createdAt))

  return {
    application: application ?? null,
    submission: submission ?? null,
    reviewerNotes: reviewerNotes.map((note) => ({ ...note, notes: note.notes! })),
    issues: issueRows.map((issue) => ({ ...issue, moduleLabel: getModuleDefinition(issue.moduleName).label })),
  }
}

/**
 * What the organizer is about to confirm at Gate 3: the same snapshot
 * `submitFinalConfirmation` stores, plus the attestation text they agree to.
 */
export async function getConfirmationPreview(
  munId: string,
  session: Session | null,
): Promise<{ snapshot: Awaited<ReturnType<typeof buildSnapshot>>; attestation: string }> {
  await assertCanReadMunReview(munId, session)
  return { snapshot: await buildSnapshot(munId), attestation: ORGANIZER_ATTESTATION }
}
