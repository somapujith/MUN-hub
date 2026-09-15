import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { getModuleDefinition } from '@/lib/lifecycle/module-registry'
import { recomputeMunProgress } from '@/lib/lifecycle/module-completion'
import { PRD_STATE_ALIASES } from '@/lib/lifecycle/mun-state-machine'

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
  /** Per-check breakdown from the module's validator — empty until Task 9 wires real `validate` functions. */
  checks: []
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

  const modules: ModuleProgressSummary[] = progress.modules.map((m) => ({
    key: m.key,
    label: getModuleDefinition(m.key).label,
    isRequired: m.isRequired,
    completionStatus: m.completionStatus,
    completionPercentage: m.completionPercentage,
    verificationState: m.verificationState,
    blockingIssueCount: m.blockingIssueCount,
    checks: [],
  }))

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
