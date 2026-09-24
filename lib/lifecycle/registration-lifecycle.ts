import { and, asc, count, eq, gt, gte, inArray, isNull, lt, lte, notInArray, or, type SQL } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { db } from '@/lib/db/client'
import {
  achievements,
  munSubmissions,
  muns,
  organizerProfiles,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { MunStatus, Role } from '@/lib/db/schema-enums'
import { notifyConferenceCancelled } from './lifecycle-events'
import { canTransition, transitionMun } from './mun-state-machine'

// -----------------------------------------------------------------------------
// Registration & conference lifecycle controls
// -----------------------------------------------------------------------------
//
// Everything after go-live: PUBLISHED -> REGISTRATION_OPEN ->
// REGISTRATION_CLOSED -> CONFERENCE_ACTIVE -> COMPLETED -> ARCHIVED, plus
// CANCELLED. Two entry points drive it:
//
//   - `runLifecycleAction` — an organizer/staff request
//     (POST /api/v1/muns/:munId/lifecycle/:action).
//   - `runScheduledLifecycleTransitions` — the cron hook (opens registration
//     at `registrationOpensAt`, closes it at `registrationDeadline`, starts the
//     conference on `startDate`).
//
// Both lock the mun row and re-check state + preconditions inside one
// transaction, then apply the change through `transitionMun` (which writes
// the `verification_logs` audit row). The rules for every action live in
// `planAction` so the request path, the cron path and the read-only
// `getLifecycleOverview` (what the organizer settings page renders) can never
// disagree about what is allowed.
//
// Who may do what:
//   open-registration / close-registration / start-conference / complete:
//     the owning organizer or staff (OPERATIONS/ADMIN/SUPER_ADMIN).
//   archive: staff only.
//   cancel: the owning organizer or ADMIN/SUPER_ADMIN, always with a reason.
//     An organizer can't cancel a SUSPENDED mun (that's MUNHub's call while
//     it is suspended).
//
// Timing rules use Indian Standard Time calendar days (the product's market;
// IST is a fixed +05:30 with no DST). The setup form stores conference dates
// as bare dates (UTC midnight), so "the day" of a timestamp is its IST day:
//   start-conference: from the IST day before `startDate`.
//   complete: once the IST day of `endDate` (falling back to `startDate`) is
//     over. Staff may complete earlier, and only staff can complete from
//     RESULTS_UNDER_REVIEW (that completion is the results-review decision).
//   scheduled start: on the IST day of `startDate`.
//
// Cancelling keeps CONFIRMED registrations exactly as they are — there are no
// refunds in MUN Hub. It releases in-flight seat holds (PENDING /
// PAYMENT_PENDING) so a checkout that completes afterwards is handled as a
// late payment (an admin-resolved payment exception) instead of confirming a
// seat at a cancelled conference, and withdraws any open go-live submission so
// the mun drops out of the review queues.
// -----------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = Pick<typeof db, 'select'>

export const LIFECYCLE_ACTIONS = [
  'open-registration',
  'close-registration',
  'start-conference',
  'complete',
  'archive',
  'cancel',
] as const

export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number]

export function isLifecycleAction(value: string): value is LifecycleAction {
  return (LIFECYCLE_ACTIONS as readonly string[]).includes(value)
}

/** The status each action ends in (start-conference may pass through REGISTRATION_CLOSED first). */
export const LIFECYCLE_ACTION_TARGET: Record<LifecycleAction, MunStatus> = {
  'open-registration': 'REGISTRATION_OPEN',
  'close-registration': 'REGISTRATION_CLOSED',
  'start-conference': 'CONFERENCE_ACTIVE',
  complete: 'COMPLETED',
  archive: 'ARCHIVED',
  cancel: 'CANCELLED',
}

export const CANCEL_REASON_MAX_LENGTH = 1000

const STAFF_ROLES: readonly Role[] = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']
const CANCEL_STAFF_ROLES: readonly Role[] = ['ADMIN', 'SUPER_ADMIN']

// Seat holds that haven't turned into a confirmed registration yet — mirrors
// lib/actions/registration.ts's RELEASABLE_STATUSES.
const IN_FLIGHT_REGISTRATION_STATUSES = ['PENDING', 'PAYMENT_PENDING'] as const
// Terminal mun_submissions statuses — mirrors lib/lifecycle/go-live.ts's
// ACTIVE_SUBMISSION_PREDICATE.
const TERMINAL_SUBMISSION_STATUSES = ['PUBLISHED', 'REJECTED', 'WITHDRAWN'] as const

export const LIFECYCLE_ERRORS = {
  reasonRequired: 'A reason is required to cancel a conference',
  reasonTooLong: `The reason must be at most ${CANCEL_REASON_MAX_LENGTH} characters`,
  noActivePass: 'Add at least one active registration pass before opening registration',
  paymentNotVerified:
    'Finish the payment step of organizer onboarding (add your UPI payout details) before opening registration for a paid pass',
  deadlineMissing: 'Set a registration deadline in Setup before opening registration',
  deadlinePassed: 'The registration deadline has passed — move it in Setup before opening registration',
  conferenceStarted: 'The conference has already started, so registration can no longer be opened',
  startDateMissing: 'Set the conference start date in Setup before starting the conference',
  endDateMissing: 'Set the conference end date in Setup before completing the conference',
  resultsUnderReview: 'Results are under MUNHub review — MUNHub completes the conference once they are approved',
  suspended: 'This MUN is suspended — contact MUNHub support to cancel it',
} as const

/**
 * A lifecycle request that is well-formed and permitted but can't be applied:
 * a failed precondition or a wrong current status (409), or a bad reason
 * (400). The HTTP layer (server/routes/mun-lifecycle.ts) maps it by `status`;
 * `Forbidden` / `Mun not found` stay plain errors for the shared handler.
 */
export class LifecycleActionError extends Error {
  readonly status: 400 | 409

  constructor(message: string, status: 400 | 409) {
    super(message)
    this.name = 'LifecycleActionError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// IST calendar-day helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

/** The instant the Indian Standard Time calendar day containing `date` began. */
export function startOfIstDay(date: Date): Date {
  const istDayIndex = Math.floor((date.getTime() + IST_OFFSET_MS) / DAY_MS)
  return new Date(istDayIndex * DAY_MS - IST_OFFSET_MS)
}

/** First instant the organizer may start the conference: the IST day before `startDate`. */
export function conferenceStartWindowOpensAt(startDate: Date): Date {
  return new Date(startOfIstDay(startDate).getTime() - DAY_MS)
}

/** Instant the scheduler starts the conference: the beginning of `startDate`'s IST day. */
export function conferenceStartsAt(startDate: Date): Date {
  return startOfIstDay(startDate)
}

/** First instant a non-staff actor may complete the conference: the IST day after `endDate`. */
export function conferenceCompletableAt(endDate: Date): Date {
  return new Date(startOfIstDay(endDate).getTime() + DAY_MS)
}

const IST_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const IST_DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const lifecycleMunColumns = {
  id: muns.id,
  name: muns.name,
  organizerId: muns.organizerId,
  status: muns.status,
  startDate: muns.startDate,
  endDate: muns.endDate,
  registrationOpensAt: muns.registrationOpensAt,
  registrationDeadline: muns.registrationDeadline,
}

interface LifecycleMun {
  id: string
  name: string
  organizerId: string
  status: MunStatus
  startDate: Date | null
  endDate: Date | null
  registrationOpensAt: Date | null
  registrationDeadline: Date | null
}

interface LifecycleActor {
  isOwner: boolean
  role: Role | 'SYSTEM'
}

/** What opening registration depends on besides the mun row itself. */
interface RegistrationReadiness {
  purchasablePassCount: number
  hasPaidPass: boolean
  /**
   * Whether the mun's organizer has finished the PAYMENT step of organizer
   * onboarding (lib/actions/organizer-onboarding.ts) — `organizer_profiles`
   * has a non-null `upiId`/`upiPhone`, the same pair `acceptOrganizerAgreement`
   * requires before it locks the wizard. This is account-level, not per-mun.
   */
  organizerUpiOnboardingComplete: boolean
}

interface PlanStep {
  to: MunStatus
  note?: string
}

type ActionPlan =
  | { kind: 'ready'; steps: PlanStep[] }
  // Right state for this action, but a precondition fails — shown disabled.
  | { kind: 'blocked'; reason: string }
  // Not an action for this mun's current status / this actor — not shown.
  | { kind: 'unavailable'; reason: string }

function isStaff(actor: LifecycleActor): boolean {
  return actor.role === 'SYSTEM' || STAFF_ROLES.includes(actor.role)
}

function isPermitted(action: LifecycleAction, actor: LifecycleActor): boolean {
  switch (action) {
    case 'archive':
      return isStaff(actor)
    case 'cancel':
      return actor.isOwner || actor.role === 'SYSTEM' || CANCEL_STAFF_ROLES.includes(actor.role)
    default:
      return actor.isOwner || isStaff(actor)
  }
}

function describeActor(mun: LifecycleMun, session: Session): LifecycleActor {
  return { isOwner: mun.organizerId === session.userId, role: session.role }
}

const SYSTEM_ACTOR: LifecycleActor = { isOwner: false, role: 'SYSTEM' }

function planAction(
  action: LifecycleAction,
  mun: LifecycleMun,
  actor: LifecycleActor,
  readiness: RegistrationReadiness | null,
  now: Date,
): ActionPlan {
  const { status } = mun

  switch (action) {
    case 'open-registration': {
      if (status !== 'PUBLISHED') {
        return {
          kind: 'unavailable',
          reason:
            status === 'REGISTRATION_OPEN'
              ? 'Registration is already open'
              : `Registration can only be opened for a live MUN (current status: ${status})`,
        }
      }
      if (!readiness) throw new Error('Registration readiness was not loaded')
      if (readiness.purchasablePassCount === 0) return { kind: 'blocked', reason: LIFECYCLE_ERRORS.noActivePass }
      if (readiness.hasPaidPass && !readiness.organizerUpiOnboardingComplete) {
        return { kind: 'blocked', reason: LIFECYCLE_ERRORS.paymentNotVerified }
      }
      if (!mun.registrationDeadline) return { kind: 'blocked', reason: LIFECYCLE_ERRORS.deadlineMissing }
      if (mun.registrationDeadline < now) return { kind: 'blocked', reason: LIFECYCLE_ERRORS.deadlinePassed }
      if (mun.startDate && now >= conferenceStartsAt(mun.startDate)) {
        return { kind: 'blocked', reason: LIFECYCLE_ERRORS.conferenceStarted }
      }
      if (mun.registrationOpensAt && mun.registrationOpensAt > now) {
        return {
          kind: 'blocked',
          reason: `Registration is scheduled to open on ${IST_DATE_TIME.format(mun.registrationOpensAt)} IST and opens automatically then — move the opening date in Setup to open it sooner`,
        }
      }
      return { kind: 'ready', steps: [{ to: 'REGISTRATION_OPEN' }] }
    }

    case 'close-registration': {
      if (status !== 'REGISTRATION_OPEN') {
        return { kind: 'unavailable', reason: `Registration is not open (current status: ${status})` }
      }
      return { kind: 'ready', steps: [{ to: 'REGISTRATION_CLOSED' }] }
    }

    case 'start-conference': {
      if (status !== 'REGISTRATION_OPEN' && status !== 'REGISTRATION_CLOSED') {
        return {
          kind: 'unavailable',
          reason:
            status === 'CONFERENCE_ACTIVE'
              ? 'The conference is already in progress'
              : `The conference can only be started after registration has opened (current status: ${status})`,
        }
      }
      if (!mun.startDate) return { kind: 'blocked', reason: LIFECYCLE_ERRORS.startDateMissing }
      const opensAt = conferenceStartWindowOpensAt(mun.startDate)
      if (now < opensAt) {
        return {
          kind: 'blocked',
          reason: `The conference can be started from ${IST_DATE.format(opensAt)}, the day before it begins`,
        }
      }
      // An open registration is closed on the way (two audited hops along the
      // documented path) rather than via a REGISTRATION_OPEN -> CONFERENCE_ACTIVE
      // shortcut edge.
      return {
        kind: 'ready',
        steps:
          status === 'REGISTRATION_OPEN'
            ? [
                { to: 'REGISTRATION_CLOSED', note: 'Registration closed because the conference started' },
                { to: 'CONFERENCE_ACTIVE' },
              ]
            : [{ to: 'CONFERENCE_ACTIVE' }],
      }
    }

    case 'complete': {
      if (status === 'RESULTS_UNDER_REVIEW') {
        return isStaff(actor)
          ? { kind: 'ready', steps: [{ to: 'COMPLETED' }] }
          : { kind: 'unavailable', reason: LIFECYCLE_ERRORS.resultsUnderReview }
      }
      if (status !== 'CONFERENCE_ACTIVE') {
        return {
          kind: 'unavailable',
          reason:
            status === 'COMPLETED'
              ? 'The conference is already completed'
              : `Only a conference in progress can be completed (current status: ${status})`,
        }
      }
      if (!isStaff(actor)) {
        const lastDay = mun.endDate ?? mun.startDate
        if (!lastDay) return { kind: 'blocked', reason: LIFECYCLE_ERRORS.endDateMissing }
        const completableAt = conferenceCompletableAt(lastDay)
        if (now < completableAt) {
          return {
            kind: 'blocked',
            reason: `The conference can be marked complete once it has ended — from ${IST_DATE.format(completableAt)}`,
          }
        }
      }
      return { kind: 'ready', steps: [{ to: 'COMPLETED' }] }
    }

    case 'archive': {
      if (status !== 'COMPLETED') {
        return {
          kind: 'unavailable',
          reason:
            status === 'ARCHIVED'
              ? 'The conference is already archived'
              : `Only a completed conference can be archived (current status: ${status})`,
        }
      }
      return { kind: 'ready', steps: [{ to: 'ARCHIVED' }] }
    }

    case 'cancel': {
      if (status === 'CANCELLED') return { kind: 'unavailable', reason: 'The conference is already cancelled' }
      if (!canTransition(status, 'CANCELLED')) {
        return { kind: 'unavailable', reason: `A conference in status ${status} can't be cancelled` }
      }
      if (status === 'SUSPENDED' && !(actor.role === 'SYSTEM' || CANCEL_STAFF_ROLES.includes(actor.role))) {
        return { kind: 'unavailable', reason: LIFECYCLE_ERRORS.suspended }
      }
      return { kind: 'ready', steps: [{ to: 'CANCELLED' }] }
    }
  }
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

async function lockMun(tx: Tx, munId: string): Promise<LifecycleMun> {
  const [mun] = await tx.select(lifecycleMunColumns).from(muns).where(eq(muns.id, munId)).for('update').limit(1)
  if (!mun) throw new Error('Mun not found')
  return mun
}

async function loadRegistrationReadiness(
  reader: Reader,
  munId: string,
  organizerId: string,
  now: Date,
): Promise<RegistrationReadiness> {
  const passes = await reader
    .select({ price: registrationProducts.price, earlyBirdPrice: registrationProducts.earlyBirdPrice })
    .from(registrationProducts)
    .where(
      and(
        eq(registrationProducts.munId, munId),
        eq(registrationProducts.status, 'active'),
        or(isNull(registrationProducts.deadline), gt(registrationProducts.deadline, now)),
      ),
    )

  const hasPaidPass = passes.some((pass) => pass.price > 0 || (pass.earlyBirdPrice ?? 0) > 0)

  const [profile] = await reader
    .select({ upiId: organizerProfiles.upiId, upiPhone: organizerProfiles.upiPhone })
    .from(organizerProfiles)
    .where(eq(organizerProfiles.userId, organizerId))
    .limit(1)

  return {
    purchasablePassCount: passes.length,
    hasPaidPass,
    organizerUpiOnboardingComplete: Boolean(profile?.upiId && profile?.upiPhone),
  }
}

interface ApplyPlanResult {
  status: MunStatus
  /** Only populated for `cancel` — the registrations this call swept PENDING/PAYMENT_PENDING -> CANCELLED, for notifyConferenceCancelled to email separately from already-CONFIRMED delegates. */
  justCancelledRegistrationIds: string[]
}

async function applyPlan(
  tx: Tx,
  munId: string,
  action: LifecycleAction,
  fromStatus: MunStatus,
  steps: PlanStep[],
  actorId: string,
  note: string | undefined,
  now: Date,
): Promise<ApplyPlanResult> {
  let status: MunStatus | undefined
  let justCancelledRegistrationIds: string[] = []
  for (const step of steps) {
    const updated = await transitionMun(munId, step.to, actorId, step.note ?? note, undefined, tx)
    status = updated.status
  }
  if (!status) throw new Error('Lifecycle plan had no steps')

  // Completing from RESULTS_UNDER_REVIEW IS the results-review decision, so it
  // must have the same effect as `reviewResults('APPROVE')` (lib/actions/
  // results.ts) — which marks every award verified. Without this, staff who
  // pressed "Mark completed" instead of "Approve results" left the awards
  // permanently 'unverified': COMPLETED is in `RESULTS_LOCKED_STATUSES`, and
  // `reviewResults` only accepts RESULTS_UNDER_REVIEW, so there was no way
  // back.
  if (action === 'complete' && fromStatus === 'RESULTS_UNDER_REVIEW') {
    await tx.update(achievements).set({ verificationStatus: 'verified' }).where(eq(achievements.munId, munId))
  }

  if (action === 'cancel') {
    const swept = await tx
      .update(registrations)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(and(eq(registrations.munId, munId), inArray(registrations.status, [...IN_FLIGHT_REGISTRATION_STATUSES])))
      .returning({ id: registrations.id })
    justCancelledRegistrationIds = swept.map((row) => row.id)

    await tx
      .update(munSubmissions)
      .set({ status: 'WITHDRAWN', slaState: 'COMPLETED', decidedAt: now, updatedAt: now })
      .where(
        and(eq(munSubmissions.munId, munId), notInArray(munSubmissions.status, [...TERMINAL_SUBMISSION_STATUSES])),
      )
  }

  return { status, justCancelledRegistrationIds }
}

function normalizeReason(reason: string | null | undefined): string | undefined {
  const trimmed = reason?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > CANCEL_REASON_MAX_LENGTH) {
    throw new LifecycleActionError(LIFECYCLE_ERRORS.reasonTooLong, 400)
  }
  return trimmed
}

async function runAfterCommit(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    console.error(`[registration-lifecycle] ${label} notification failed`, error)
  }
}

// ---------------------------------------------------------------------------
// Request path
// ---------------------------------------------------------------------------

export interface LifecycleActionResult {
  munId: string
  status: MunStatus
}

/**
 * Applies one lifecycle action for the caller-supplied `session` (identity
 * comes only from the session). Row-locks the mun, checks permission, current
 * status and preconditions, then transitions through `transitionMun` in the
 * same transaction. `reason` is stored as the audit note (required for
 * `cancel`).
 *
 * Throws `Error('Forbidden')` (no session / not permitted),
 * `Error('Mun not found')`, or `LifecycleActionError` (409 wrong status or
 * failed precondition, 400 bad reason). After a successful cancel commits,
 * `notifyConferenceCancelled` runs; its failure is logged, never thrown.
 */
export async function runLifecycleAction(
  munId: string,
  action: LifecycleAction,
  input: { reason?: string | null },
  session: Session | null,
  now: Date = new Date(),
): Promise<LifecycleActionResult> {
  if (!session) throw new Error('Forbidden')
  if (!isLifecycleAction(action)) {
    throw new LifecycleActionError(`Unknown lifecycle action "${String(action)}"`, 400)
  }
  const reason = normalizeReason(input.reason)
  if (action === 'cancel' && !reason) throw new LifecycleActionError(LIFECYCLE_ERRORS.reasonRequired, 400)

  const { status, justCancelledRegistrationIds } = await db.transaction(async (tx) => {
    const mun = await lockMun(tx, munId)
    const actor = describeActor(mun, session)
    if (!isPermitted(action, actor)) throw new Error('Forbidden')

    const readiness =
      action === 'open-registration' && mun.status === 'PUBLISHED'
        ? await loadRegistrationReadiness(tx, munId, mun.organizerId, now)
        : null
    const plan = planAction(action, mun, actor, readiness, now)
    if (plan.kind !== 'ready') throw new LifecycleActionError(plan.reason, 409)

    return applyPlan(tx, munId, action, mun.status, plan.steps, session.userId, reason, now)
  })

  if (action === 'cancel') {
    await runAfterCommit('conference cancelled', () => notifyConferenceCancelled(munId, { justCancelledRegistrationIds }))
  }

  return { munId, status }
}

export interface LifecycleActionOption {
  action: LifecycleAction
  targetStatus: MunStatus
  /** False when a precondition currently fails — `blockedReason` says which. */
  available: boolean
  blockedReason: string | null
  requiresReason: boolean
}

export interface LifecycleOverview {
  munId: string
  name: string
  status: MunStatus
  startDate: Date | null
  endDate: Date | null
  registrationOpensAt: Date | null
  registrationDeadline: Date | null
  confirmedRegistrations: number
  /** The next actions for this mun's current status that the caller may take, in lifecycle order. */
  actions: LifecycleActionOption[]
}

/**
 * Read-only view of a mun's registration/conference lifecycle for the owning
 * organizer or staff: current status, the dates that drive it, and which
 * actions the caller can take next (with the failing precondition for any
 * that are currently blocked). Evaluated with the same rules as
 * `runLifecycleAction`, so a button shown as available is one the POST will
 * accept unless the mun changes in between.
 */
export async function getLifecycleOverview(
  munId: string,
  session: Session | null,
  now: Date = new Date(),
): Promise<LifecycleOverview> {
  if (!session) throw new Error('Forbidden')

  const [mun] = await db.select(lifecycleMunColumns).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  const actor = describeActor(mun, session)
  if (!actor.isOwner && !isStaff(actor)) throw new Error('Forbidden')

  const readiness = mun.status === 'PUBLISHED' ? await loadRegistrationReadiness(db, munId, mun.organizerId, now) : null

  const actions: LifecycleActionOption[] = []
  for (const action of LIFECYCLE_ACTIONS) {
    if (!isPermitted(action, actor)) continue
    const plan = planAction(action, mun, actor, readiness, now)
    if (plan.kind === 'unavailable') continue
    actions.push({
      action,
      targetStatus: LIFECYCLE_ACTION_TARGET[action],
      available: plan.kind === 'ready',
      blockedReason: plan.kind === 'blocked' ? plan.reason : null,
      requiresReason: action === 'cancel',
    })
  }

  const [{ confirmed } = { confirmed: 0 }] = await db
    .select({ confirmed: count() })
    .from(registrations)
    .where(and(eq(registrations.munId, munId), eq(registrations.status, 'CONFIRMED')))

  return {
    munId: mun.id,
    name: mun.name,
    status: mun.status,
    startDate: mun.startDate,
    endDate: mun.endDate,
    registrationOpensAt: mun.registrationOpensAt,
    registrationDeadline: mun.registrationDeadline,
    confirmedRegistrations: confirmed,
    actions,
  }
}

// ---------------------------------------------------------------------------
// Scheduler hook
// ---------------------------------------------------------------------------

export interface ScheduledLifecycleResult {
  opened: string[]
  closed: string[]
  started: string[]
  /** Due muns whose preconditions don't currently pass — expected, retried next run. */
  skipped: Array<{ munId: string; action: LifecycleAction; reason: string }>
  /**
   * Due muns whose transition threw. Unlike `skipped` this is never normal —
   * the caller (lib/jobs/registry.ts) logs it at error level and fails the
   * job, so a systemic fault (e.g. a SYSTEM_ACTOR_USER_ID that no longer
   * resolves to a user, which makes every audit-log insert fail its NOT NULL
   * foreign key) raises an alert instead of hiding in an info line.
   */
  failed: Array<{ munId: string; action: LifecycleAction; reason: string }>
}

export interface ScheduledLifecycleOptions {
  /** Restrict the run to these muns (tests; targeted re-runs). */
  munIds?: readonly string[]
  /** Maximum muns handled per step per run. Default 100. */
  batchSize?: number
}

type ScheduledAction = Extract<LifecycleAction, 'open-registration' | 'close-registration' | 'start-conference'>

const SCHEDULED_NOTES: Record<ScheduledAction, string> = {
  'open-registration': 'Automatic: registration opening time reached',
  'close-registration': 'Automatic: registration deadline passed or the conference started',
  'start-conference': 'Automatic: conference start date reached',
}

function isDue(action: ScheduledAction, mun: LifecycleMun, now: Date): boolean {
  switch (action) {
    case 'open-registration':
      return mun.status === 'PUBLISHED' && mun.registrationOpensAt != null && mun.registrationOpensAt <= now
    case 'close-registration':
      return (
        mun.status === 'REGISTRATION_OPEN' &&
        ((mun.registrationDeadline != null && mun.registrationDeadline < now) ||
          (mun.startDate != null && now >= conferenceStartsAt(mun.startDate)))
      )
    case 'start-conference':
      return mun.status === 'REGISTRATION_CLOSED' && mun.startDate != null && now >= conferenceStartsAt(mun.startDate)
  }
}

type StepOutcome =
  | { kind: 'applied' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'not-due' }

async function runScheduledStep(
  munId: string,
  action: ScheduledAction,
  now: Date,
  actorId: string,
): Promise<StepOutcome> {
  try {
    return await db.transaction(async (tx): Promise<StepOutcome> => {
      const mun = await lockMun(tx, munId)
      // Re-checked under the lock: a concurrent run or an organizer action may
      // already have moved this mun since the candidate query.
      if (!isDue(action, mun, now)) return { kind: 'not-due' }

      const readiness =
        action === 'open-registration' ? await loadRegistrationReadiness(tx, munId, mun.organizerId, now) : null
      const plan = planAction(action, mun, SYSTEM_ACTOR, readiness, now)
      if (plan.kind !== 'ready') return { kind: 'skipped', reason: plan.reason }

      await applyPlan(tx, munId, action, mun.status, plan.steps, actorId, SCHEDULED_NOTES[action], now)
      return { kind: 'applied' }
    })
  } catch (error) {
    // Deliberately NOT reported as 'skipped': a failed precondition is
    // routine, an exception is not. Collapsing the two hid systemic faults
    // (a bad SYSTEM_ACTOR_USER_ID makes every transition fail its audit-row
    // foreign key) behind an info-level log line on an "ok" job.
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Time-driven lifecycle transitions, meant to run on a cron (every 5 minutes
 * is fine). In order:
 *   1. PUBLISHED muns whose `registrationOpensAt` has passed -> REGISTRATION_OPEN,
 *      when the open-registration preconditions pass (otherwise reported in
 *      `skipped` and retried next run).
 *   2. REGISTRATION_OPEN muns whose `registrationDeadline` has passed, or whose
 *      conference start day has begun -> REGISTRATION_CLOSED.
 *   3. REGISTRATION_CLOSED muns whose `startDate` IST day has begun ->
 *      CONFERENCE_ACTIVE (so a mun closed in step 2 on its start day also
 *      starts in the same run).
 * It never completes, archives or cancels anything.
 *
 * Idempotent and safe to run concurrently: every mun is handled in its own
 * transaction that row-locks it and re-checks it is still due, so a mun is
 * transitioned at most once and a failure on one mun never aborts the rest.
 * A mun whose preconditions don't pass lands in `skipped` (routine); a mun
 * whose transition threw lands in `failed`, which the job wrapper treats as
 * an error rather than a skip.
 *
 * `actorId` must be a real `users.id` — `verification_logs.reviewer_id` is a
 * NOT NULL foreign key. The Workers scheduled handler reads it from
 * `getRuntimeEnv('SYSTEM_ACTOR_USER_ID')` (a dedicated staff account) and must
 * run this inside the same Hyperdrive/runtime-env request scope the HTTP
 * middleware sets up, since this uses `db` directly.
 */
export async function runScheduledLifecycleTransitions(
  now: Date,
  actorId: string,
  options: ScheduledLifecycleOptions = {},
): Promise<ScheduledLifecycleResult> {
  const result: ScheduledLifecycleResult = { opened: [], closed: [], started: [], skipped: [], failed: [] }
  if (!actorId) throw new Error('runScheduledLifecycleTransitions requires a system actor user id')
  if (options.munIds && options.munIds.length === 0) return result

  // Checked once up front rather than discovered as a foreign-key violation on
  // every single mun: `verification_logs.reviewer_id` is a NOT NULL FK, so a
  // SYSTEM_ACTOR_USER_ID pointing at a missing or deleted account fails every
  // transition this job attempts.
  const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.id, actorId)).limit(1)
  if (!actor) {
    throw new Error(`runScheduledLifecycleTransitions: system actor user ${actorId} does not exist`)
  }

  const batchSize = options.batchSize ?? 100
  const scope = options.munIds ? inArray(muns.id, [...options.munIds]) : undefined
  // A start date whose IST day has begun is exactly one before the end of
  // today's IST day — lets the candidate queries use plain comparisons.
  const endOfIstToday = new Date(startOfIstDay(now).getTime() + DAY_MS)

  const steps: Array<{ action: ScheduledAction; where: SQL | undefined; order: SQL; into: string[] }> = [
    {
      action: 'open-registration',
      // Muns that can never open any more (deadline gone, conference begun)
      // are left out here rather than reported as skipped every run — they'd
      // otherwise also crowd due muns out of the batch.
      where: and(
        eq(muns.status, 'PUBLISHED'),
        lte(muns.registrationOpensAt, now),
        gte(muns.registrationDeadline, now),
        or(isNull(muns.startDate), gte(muns.startDate, endOfIstToday)),
        scope,
      ),
      order: asc(muns.registrationOpensAt),
      into: result.opened,
    },
    {
      action: 'close-registration',
      where: and(
        eq(muns.status, 'REGISTRATION_OPEN'),
        or(lt(muns.registrationDeadline, now), lt(muns.startDate, endOfIstToday)),
        scope,
      ),
      order: asc(muns.registrationDeadline),
      into: result.closed,
    },
    {
      action: 'start-conference',
      where: and(eq(muns.status, 'REGISTRATION_CLOSED'), lt(muns.startDate, endOfIstToday), scope),
      order: asc(muns.startDate),
      into: result.started,
    },
  ]

  for (const step of steps) {
    const candidates = await db
      .select({ id: muns.id })
      .from(muns)
      .where(step.where)
      .orderBy(step.order, asc(muns.id))
      .limit(batchSize)

    for (const { id } of candidates) {
      const outcome = await runScheduledStep(id, step.action, now, actorId)
      if (outcome.kind === 'applied') step.into.push(id)
      else if (outcome.kind === 'skipped') result.skipped.push({ munId: id, action: step.action, reason: outcome.reason })
      else if (outcome.kind === 'failed') result.failed.push({ munId: id, action: step.action, reason: outcome.reason })
    }
  }

  return result
}
