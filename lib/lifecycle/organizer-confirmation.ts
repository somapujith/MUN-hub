import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  munModuleVerifications,
  verificationIssues,
  muns,
  committees,
  portfolios,
  registrationProducts,
  organizerConfirmations,
  munMedia,
  munExecutiveBoard,
  munFormFields,
  munPaymentSettings,
  munDocuments,
  munScheduleItems,
  munContacts,
  accommodationOptions,
  accommodationOptionFields,
} from '@/lib/db/schema'
import type { Mun } from '@/lib/types'
import type { Session } from '@/lib/auth/adapter'
import { runInBackground } from '@/lib/background-tasks'
import { notifyPipelineEvent } from '@/lib/notifications/pipeline-events'
import { resolveMunNotificationContext } from '@/lib/notifications/resolve-recipients'
import { transitionMun } from './mun-state-machine'
import { validateMunForSubmission } from './validation'

/**
 * Fire-and-forget notification helper — same reasoning as go-live.ts's
 * `notifyAfterCommit` (a notification failure must never surface as a
 * failure of the state change that triggered it), duplicated locally rather
 * than imported since this file has no transaction boundary to wait on (see
 * below) and the two call sites otherwise have nothing else in common.
 * `runInBackground` keeps it alive past the response on Workers.
 */
function notifyFireAndForget(work: () => Promise<void>): void {
  runInBackground('organizer-confirmation pipeline notification', work)
}

/**
 * Snapshots the full submission surface for Gate 3 (PRD §14). Widened
 * (Task 10, 2026-09-14) from slice 1's 4-table snapshot
 * (mun/committees/portfolios/registration_products) to cover all 15 tracked
 * modules' data: the 7 net-new Task 4 tables (media, executive board, form
 * fields, payment settings, documents, schedule items, contact) plus
 * accommodation. See design doc Section 4.1.
 *
 * `munPaymentSettings` is selected with explicit columns, NEVER `select()`
 * with no argument — `panCiphertext`/`accountNumberCiphertext` must never
 * leave this table via any read path, snapshot included. See the security
 * comment on `munPaymentSettings` in lib/db/schema.ts.
 *
 * Exported (Task 11, 2026-09-14) — `publishFromQueue` (lib/lifecycle/
 * go-live.ts) reuses this exact snapshot builder for the `mun_versions` row
 * it creates at publish time, rather than duplicating the 12-table read.
 */
export async function buildSnapshot(munId: string) {
  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  const munCommittees = await db.select().from(committees).where(eq(committees.munId, munId))
  const committeeIds = munCommittees.map((c) => c.id)
  const munPortfolios = committeeIds.length
    ? await db.select().from(portfolios).where(inArray(portfolios.committeeId, committeeIds))
    : []
  const munProducts = await db.select().from(registrationProducts).where(eq(registrationProducts.munId, munId))

  const media = await db.select().from(munMedia).where(eq(munMedia.munId, munId))
  const executiveBoard = await db.select().from(munExecutiveBoard).where(eq(munExecutiveBoard.munId, munId))
  const formFields = await db.select().from(munFormFields).where(eq(munFormFields.munId, munId))
  const [paymentSettings] = await db
    .select({
      id: munPaymentSettings.id,
      munId: munPaymentSettings.munId,
      legalName: munPaymentSettings.legalName,
      orgType: munPaymentSettings.orgType,
      addressLine1: munPaymentSettings.addressLine1,
      addressLine2: munPaymentSettings.addressLine2,
      city: munPaymentSettings.city,
      state: munPaymentSettings.state,
      postalCode: munPaymentSettings.postalCode,
      panLast4: munPaymentSettings.panLast4,
      gstin: munPaymentSettings.gstin,
      authorizedRepName: munPaymentSettings.authorizedRepName,
      authorizedRepEmail: munPaymentSettings.authorizedRepEmail,
      accountHolderName: munPaymentSettings.accountHolderName,
      bankName: munPaymentSettings.bankName,
      accountNumberLast4: munPaymentSettings.accountNumberLast4,
      ifsc: munPaymentSettings.ifsc,
      accountType: munPaymentSettings.accountType,
      gateway: munPaymentSettings.gateway,
      currency: munPaymentSettings.currency,
      refundPolicy: munPaymentSettings.refundPolicy,
      settlementNotes: munPaymentSettings.settlementNotes,
      verificationState: munPaymentSettings.verificationState,
      verifiedAt: munPaymentSettings.verifiedAt,
      verifiedBy: munPaymentSettings.verifiedBy,
      createdAt: munPaymentSettings.createdAt,
      updatedAt: munPaymentSettings.updatedAt,
    })
    .from(munPaymentSettings)
    .where(eq(munPaymentSettings.munId, munId))
    .limit(1)
  const documents = await db.select().from(munDocuments).where(eq(munDocuments.munId, munId))
  const scheduleItems = await db.select().from(munScheduleItems).where(eq(munScheduleItems.munId, munId))
  const [contact] = await db.select().from(munContacts).where(eq(munContacts.munId, munId)).limit(1)
  const options = await db.select().from(accommodationOptions).where(eq(accommodationOptions.munId, munId))
  const optionIds = options.map((o) => o.id)
  const optionFields = optionIds.length
    ? await db.select().from(accommodationOptionFields).where(inArray(accommodationOptionFields.optionId, optionIds))
    : []

  return {
    mun,
    committees: munCommittees,
    portfolios: munPortfolios,
    registrationProducts: munProducts,
    media,
    executiveBoard,
    formFields,
    paymentSettings: paymentSettings ?? null,
    documents,
    scheduleItems,
    contact: contact ?? null,
    accommodationOptions: options,
    accommodationOptionFields: optionFields,
  }
}

const CONFIRMABLE_STATUSES = ['CONTENT_SUBMITTED', 'ORGANIZER_CONFIRMATION'] as const

/**
 * What the organizer attests to at Gate 3. Stored inside the confirmation
 * snapshot, so a later change to this wording never rewrites what an
 * earlier organizer actually agreed to.
 */
export const ORGANIZER_ATTESTATION =
  'I confirm that everything in this submission is accurate and complete, that I am authorized to publish this conference on MUN Hub, and that I will keep these details up to date. I understand MUN Hub will review every section before it goes live.'

/**
 * Organizer Final Confirmation (PRD Section 14, Gate 3): the organizer
 * reviews a complete summary of their submission and confirms it's accurate,
 * complete, and authorized for publication. Snapshots the current mun + all
 * 15 tracked modules' data into `organizer_confirmations`, then advances the
 * mun to VERIFICATION.
 *
 * Accepts CONTENT_SUBMITTED **or** ORGANIZER_CONFIRMATION as the starting
 * status (Task 10, 2026-09-14) — `submitMunForReview` now moves the mun to
 * ORGANIZER_CONFIRMATION itself on a passing validation run, so this
 * function must treat that as an already-reached (not re-transitioned)
 * state rather than hard-requiring CONTENT_SUBMITTED.
 *
 * **Re-runs `validateMunForSubmission` itself before confirming.** Without
 * this, an organizer could pass validation via `submitMunForReview`, then
 * edit a field to break something (a committee delete, a payment detail
 * change), then call this function and slip through on stale validation.
 * A validation regression here throws — the transaction never opens, no
 * transition is attempted, nothing is left half-confirmed.
 */
export async function submitFinalConfirmation(
  munId: string,
  session: Session | null,
  /** The HTTP route always passes this; `attested` must be true when it's given. */
  opts?: { attested: boolean },
): Promise<Mun> {
  if (!session) throw new Error('Forbidden')
  if (opts && opts.attested !== true) {
    throw new Error('You must confirm the submission is accurate and complete')
  }

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  if (mun.organizerId !== session.userId && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN') {
    throw new Error('Forbidden')
  }
  if (!CONFIRMABLE_STATUSES.includes(mun.status as (typeof CONFIRMABLE_STATUSES)[number])) {
    throw new Error(`Cannot submit final confirmation from status ${mun.status}`)
  }

  const revalidation = await validateMunForSubmission(munId)
  if (!revalidation.passed) {
    const blockerLabels = revalidation.blockers.map((blocker) => blocker.label).join('; ')
    throw new Error(`Cannot confirm — validation now fails: ${blockerLabels}`)
  }

  const [priorConfirmation] = await db
    .select({ versionNumber: organizerConfirmations.versionNumber })
    .from(organizerConfirmations)
    .where(eq(organizerConfirmations.munId, munId))
    .orderBy(desc(organizerConfirmations.versionNumber))
    .limit(1)

  const nextVersion = (priorConfirmation?.versionNumber ?? 0) + 1
  const snapshot = await buildSnapshot(munId)

  await db.transaction(async (tx) => {
    await tx.insert(organizerConfirmations).values({
      munId,
      confirmingUserId: session.userId,
      versionNumber: nextVersion,
      snapshotJson: { ...snapshot, attestation: ORGANIZER_ATTESTATION },
    })

    // The whole-submission attestation covers every module, so any module the
    // organizer hadn't individually sent for review (or that a reviewer sent
    // back and they've since fixed) goes to PENDING_REVIEW now. Reviewers can
    // then act on each one. Their feedback on those modules is answered.
    const now = new Date()
    const sentBack = await tx
      .select({ moduleName: munModuleVerifications.moduleName })
      .from(munModuleVerifications)
      .where(
        and(
          eq(munModuleVerifications.munId, munId),
          inArray(munModuleVerifications.state, ['NOT_SUBMITTED', 'CHANGES_REQUESTED']),
        ),
      )
    if (sentBack.length > 0) {
      const moduleNames = sentBack.map((row) => row.moduleName)
      await tx
        .update(munModuleVerifications)
        .set({ state: 'PENDING_REVIEW', organizerConfirmedAt: now, updatedAt: now })
        .where(and(eq(munModuleVerifications.munId, munId), inArray(munModuleVerifications.moduleName, moduleNames)))
      await tx
        .update(verificationIssues)
        .set({ resolved: true, resolvedAt: now })
        .where(
          and(
            eq(verificationIssues.munId, munId),
            inArray(verificationIssues.moduleName, moduleNames),
            eq(verificationIssues.source, 'REVIEWER'),
            eq(verificationIssues.resolved, false),
          ),
        )
    }
  })

  // Skip the redundant transition when submitMunForReview already moved the
  // mun to ORGANIZER_CONFIRMATION — it's an already-reached state, not a new
  // transition, and canTransition would reject the self-transition anyway.
  if (mun.status !== 'ORGANIZER_CONFIRMATION') {
    await transitionMun(munId, 'ORGANIZER_CONFIRMATION', session.userId, 'Organizer submitted final confirmation')
  }
  const updated = await transitionMun(munId, 'VERIFICATION', session.userId, 'Auto-advanced to MUNHub verification')

  // Fired after the transition above has already committed (transitionMun
  // runs its own transaction when no `tx` is passed in, same as every other
  // call in this function) — never inside it, matching go-live.ts's Task 12
  // Step 5 convention. VERIFICATION is PRD_STATE_ALIASES's "UNDER_REVIEW"
  // display state (mun-state-machine.ts) — this is the PipelineEvent whose
  // trigger is entering that status, not Gate 1's distinct literal
  // UNDER_REVIEW enum value (see that file's Gate-1/Gate-2 header comment).
  notifyFireAndForget(async () => {
    const context = await resolveMunNotificationContext(munId)
    await notifyPipelineEvent({ type: 'UNDER_REVIEW', munId, organizerEmail: context.organizerEmail, munName: context.munName })
  })

  return updated
}
