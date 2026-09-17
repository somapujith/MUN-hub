import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  muns,
  organizerApplications,
  organizerProfiles,
  committees,
  portfolios,
  registrationProducts,
  munExecutiveBoard,
  munFormFields,
  munPaymentSettings,
  munDocuments,
  munScheduleItems,
  munContacts,
  munMedia,
  accommodationOptions,
  accommodationOptionFields,
  munModuleVerifications,
  verificationIssues,
} from '@/lib/db/schema'
import type { Mun } from '@/lib/types/mun'
import type { MunModule, VerificationSeverity } from '@/lib/db/schema-enums'
import { MODULE_REGISTRY } from './module-registry'

// -----------------------------------------------------------------------------
// validation.ts — Automated Validation Engine (design doc Section 4, PRD §24)
// -----------------------------------------------------------------------------
//
// Architecture: ONE batched read (`loadValidationContext`), then 15 PURE
// functions (the registry's `validate(ctx)` entries, see lib/lifecycle/
// validators/*.ts). No validator ever touches the DB, awaits anything, or
// reads the clock directly — they read `ctx.now` instead, which is what
// keeps every one of them testable with a hand-built literal object and zero
// DB. This file is the ONLY place in the whole engine that performs I/O.
// -----------------------------------------------------------------------------

export type EbMemberRow = typeof munExecutiveBoard.$inferSelect
export type CommitteeRow = typeof committees.$inferSelect
export type PortfolioRow = typeof portfolios.$inferSelect
export type RegistrationProductRow = typeof registrationProducts.$inferSelect
export type FormFieldRow = typeof munFormFields.$inferSelect
export type MunDocumentRow = typeof munDocuments.$inferSelect
export type ScheduleItemRow = typeof munScheduleItems.$inferSelect
export type MunContactRow = typeof munContacts.$inferSelect
export type MunMediaRow = typeof munMedia.$inferSelect
export type AccommodationOptionRow = typeof accommodationOptions.$inferSelect
export type AccommodationOptionFieldRow = typeof accommodationOptionFields.$inferSelect
export type ModuleVerificationRow = typeof munModuleVerifications.$inferSelect
export type VerificationIssueRow = typeof verificationIssues.$inferSelect
export type OrganizerApplicationRow = typeof organizerApplications.$inferSelect

/**
 * A payment-settings row with the two write-only ciphertext columns removed.
 * Validators only ever need to know THAT payment details exist and their
 * verification state — never the encrypted contents. Selecting the columns
 * explicitly here (rather than `select()` with no argument) mirrors the same
 * "no ciphertext leaves this table" rule documented on `munPaymentSettings`
 * in lib/db/schema.ts — the validation engine is a read path, so it is
 * exactly the kind of place that rule exists to keep honest.
 */
export type MaskedPaymentSettingsRow = Omit<
  typeof munPaymentSettings.$inferSelect,
  'panCiphertext' | 'accountNumberCiphertext'
>

/** Validation runs at either the SUBMIT gate (Task 10) or PUBLISH gate (Task 11). Default: SUBMIT. */
export type ValidationStage = 'SUBMIT' | 'PUBLISH'

/**
 * Everything every validator could possibly need, loaded once. Threaded
 * through as a single plain object — see design doc Section 4: "one batched
 * read, then 15 pure functions."
 *
 * `now` exists so validators never call `Date.now()`/`new Date()`
 * themselves — passing the clock through the context is what makes every
 * date-ordering check (DATES_VENUE, PRICING_CAPACITY, SCHEDULE) testable
 * with a literal object instead of depending on wall-clock time.
 *
 * `stage` exists so PAYMENT_SETTLEMENT's severity asymmetry (see
 * validators/commerce.ts) can read it from `ctx` — validators only ever take
 * `ctx`, never `opts` directly, so `validateMunForSubmission` folds its
 * `opts.stage` into the context before calling any validator.
 */
export interface MunValidationContext {
  now: Date
  stage: ValidationStage
  mun: Mun
  organizerApplication: OrganizerApplicationRow | null
  committees: CommitteeRow[]
  portfolios: PortfolioRow[]
  registrationProducts: RegistrationProductRow[]
  ebMembers: EbMemberRow[]
  formFields: FormFieldRow[]
  paymentSettings: MaskedPaymentSettingsRow | null
  /**
   * Whether the mun's organizer has completed the account-level UPI payout
   * step (lib/actions/organizer-onboarding.ts#saveOrganizerPaymentStep) —
   * the real "payment is required" gate as of the minimum-fields cut. The
   * per-mun `mun_payment_settings` PAN/bank-account row above is legacy and
   * no longer required for submission (see validators/commerce.ts's
   * validatePaymentSettlement).
   */
  organizerPaymentLinked: boolean
  documents: MunDocumentRow[]
  scheduleItems: ScheduleItemRow[]
  contact: MunContactRow | null
  media: MunMediaRow[]
  accommodationOptions: AccommodationOptionRow[]
  accommodationOptionFields: AccommodationOptionFieldRow[]
  moduleRows: ModuleVerificationRow[]
  unresolvedIssues: VerificationIssueRow[]
}

/**
 * The only I/O in the whole validation engine. One query per table (not per
 * committee, not per portfolio) — portfolios and accommodation-option fields
 * are fetched in a single `inArray` query keyed off this mun's committee/
 * option ids rather than looped per-parent-row, which is exactly the N+1
 * shape the repo's own `8fdc449` commit (batching seat-availability queries)
 * fixed elsewhere.
 *
 * Returns `null` for the handful of "at most one row" tables (paymentSettings,
 * contact) when the organizer hasn't gotten to that module yet — validators
 * treat a `null` as "not submitted," which is itself often the failing
 * check (e.g. PAYMENT_SETTLEMENT's "details submitted" BLOCKER).
 */
/** A drizzle client or an open transaction — reads go through whichever the caller is using. */
export type ValidationReader = Pick<typeof db, 'select'>

export async function loadValidationContext(munId: string, client: ValidationReader = db): Promise<MunValidationContext> {
  const [mun] = await client.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) {
    throw new Error(`Mun "${munId}" not found`)
  }

  const [
    [organizerApplication],
    committeeRows,
    registrationProductRows,
    ebMemberRows,
    formFieldRows,
    [paymentSettingsRow],
    documentRows,
    scheduleItemRows,
    [contactRow],
    mediaRows,
    accommodationOptionRows,
    moduleRows,
    unresolvedIssues,
  ] = await Promise.all([
    client.select().from(organizerApplications).where(eq(organizerApplications.munId, munId)).limit(1),
    client.select().from(committees).where(eq(committees.munId, munId)),
    client.select().from(registrationProducts).where(eq(registrationProducts.munId, munId)),
    client.select().from(munExecutiveBoard).where(eq(munExecutiveBoard.munId, munId)),
    client.select().from(munFormFields).where(eq(munFormFields.munId, munId)),
    client
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
      .limit(1),
    client.select().from(munDocuments).where(eq(munDocuments.munId, munId)),
    client.select().from(munScheduleItems).where(eq(munScheduleItems.munId, munId)),
    client.select().from(munContacts).where(eq(munContacts.munId, munId)).limit(1),
    client.select().from(munMedia).where(eq(munMedia.munId, munId)),
    client.select().from(accommodationOptions).where(eq(accommodationOptions.munId, munId)),
    client.select().from(munModuleVerifications).where(eq(munModuleVerifications.munId, munId)),
    client
      .select()
      .from(verificationIssues)
      .where(and(eq(verificationIssues.munId, munId), eq(verificationIssues.resolved, false))),
  ])

  const [organizerProfileRow] = await client
    .select({ upiId: organizerProfiles.upiId })
    .from(organizerProfiles)
    .where(eq(organizerProfiles.userId, mun.organizerId))
    .limit(1)

  // Portfolios and accommodation-option fields both hang off a parent row
  // fetched above, not off munId directly — batch these with `inArray` over
  // the parent ids rather than looping, per design doc Section 4 / the task
  // brief's explicit "not per-committee" instruction.
  const committeeIds = committeeRows.map((c) => c.id)
  const accommodationOptionIds = accommodationOptionRows.map((o) => o.id)

  const [portfolioRows, accommodationOptionFieldRows] = await Promise.all([
    committeeIds.length > 0
      ? client.select().from(portfolios).where(inArray(portfolios.committeeId, committeeIds))
      : Promise.resolve([]),
    accommodationOptionIds.length > 0
      ? client
          .select()
          .from(accommodationOptionFields)
          .where(inArray(accommodationOptionFields.optionId, accommodationOptionIds))
      : Promise.resolve([]),
  ])

  return {
    now: new Date(),
    stage: 'SUBMIT',
    mun,
    organizerApplication: organizerApplication ?? null,
    committees: committeeRows,
    portfolios: portfolioRows,
    registrationProducts: registrationProductRows,
    ebMembers: ebMemberRows,
    formFields: formFieldRows,
    paymentSettings: paymentSettingsRow ?? null,
    organizerPaymentLinked: Boolean(organizerProfileRow?.upiId),
    documents: documentRows,
    scheduleItems: scheduleItemRows,
    contact: contactRow ?? null,
    media: mediaRows,
    accommodationOptions: accommodationOptionRows,
    accommodationOptionFields: accommodationOptionFieldRows,
    moduleRows,
    unresolvedIssues,
  }
}

/** One named pass/fail check within a module's validation result. */
export interface ValidationCheck {
  key: string
  label: string
  passed: boolean
  severity: VerificationSeverity
  message?: string
}

/** One module's full validation result — `passed` is true iff no check in this module has a failing BLOCKER. */
export interface ModuleValidationResult {
  moduleKey: MunModule
  checks: ValidationCheck[]
  passed: boolean
}

/** The whole-mun aggregate — this is PRD §24's numbered failure list, materialized as `blockers`. */
export interface MunValidationResult {
  passed: boolean
  modules: ModuleValidationResult[]
  blockers: ValidationCheck[]
}

export interface ValidateMunForSubmissionOptions {
  stage?: ValidationStage
}

/**
 * Shared "did this module pass" formula, used by every validator in
 * lib/lifecycle/validators/*.ts so the rule lives in exactly one place: a
 * module passes iff no check within it is BOTH failing AND severity
 * BLOCKER. A failing HIGH/MEDIUM/LOW check is surfaced (via `checks`) but
 * does not fail the module — only a failing BLOCKER does, matching
 * `validateMunForSubmission`'s own mun-level aggregation rule one level up.
 */
export function modulePassed(checks: ValidationCheck[]): boolean {
  return checks.every((check) => check.passed || check.severity !== 'BLOCKER')
}

/**
 * Loads the validation context ONCE, then runs every registry entry's pure
 * `validate(ctx)` over it and aggregates. `passed` is true only if NO check,
 * in any module, is both `severity === 'BLOCKER'` and `passed === false`.
 * `blockers` is that same failing-BLOCKER set, flattened across modules —
 * literally PRD §24's numbered failure list, one entry per blocker.
 */
export async function validateMunForSubmission(
  munId: string,
  opts?: ValidateMunForSubmissionOptions,
  /** Pass the caller's transaction so validation sees writes it hasn't committed yet. */
  client: ValidationReader = db,
): Promise<MunValidationResult> {
  const baseCtx = await loadValidationContext(munId, client)
  const ctx: MunValidationContext = { ...baseCtx, stage: opts?.stage ?? 'SUBMIT' }

  const modules = MODULE_REGISTRY.map((moduleDefinition) => moduleDefinition.validate(ctx))

  const blockers = modules.flatMap((moduleResult) =>
    moduleResult.checks.filter((check) => check.severity === 'BLOCKER' && !check.passed),
  )

  return {
    passed: blockers.length === 0,
    modules,
    blockers,
  }
}
