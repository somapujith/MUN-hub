import type { MunValidationContext, ModuleValidationResult, ValidationCheck } from '../validation'
import { modulePassed } from '../validation'

// -----------------------------------------------------------------------------
// validators/commerce.ts — REGISTRATION_TYPES, REGISTRATION_FORM,
// PRICING_CAPACITY, PAYMENT_SETTLEMENT
// -----------------------------------------------------------------------------
// Pure functions — see validators/content.ts's header comment for the shared
// architecture note (no I/O, no await, no direct clock reads).
// -----------------------------------------------------------------------------

export function validateRegistrationTypes(ctx: MunValidationContext): ModuleValidationResult {
  const { registrationProducts } = ctx

  const hasActiveProduct = registrationProducts.some((p) => p.status === 'active')

  const checks: ValidationCheck[] = [
    {
      key: 'at_least_one_active_registration_type',
      label: 'At least one registration type is configured and active',
      passed: hasActiveProduct,
      severity: 'BLOCKER',
      message: hasActiveProduct ? undefined : 'At least one active registration type is required.',
    },
  ]

  return { moduleKey: 'REGISTRATION_TYPES', checks, passed: modulePassed(checks) }
}

/**
 * REGISTRATION_FORM's real validation is thin per design doc Section 6 — the
 * module's structural exception (deleting/relocking a field post-VERIFIED)
 * is handled directly in the form action per Section 6, not here, because a
 * pure diff-based detector can't see deletions. This validator has nothing
 * concrete to check at submit/publish time beyond "the module itself is
 * internally consistent," so it passes with an informational note rather
 * than fabricating a check that doesn't check anything meaningful.
 */
export function validateRegistrationForm(ctx: MunValidationContext): ModuleValidationResult {
  const { formFields } = ctx

  // The one structural invariant worth naming here: every conditional field
  // must point at a fieldKey that actually exists on this mun's form. A
  // dangling `conditionalOn` would silently never show/hide correctly.
  const fieldKeys = new Set(formFields.map((f) => f.fieldKey))
  const danglingConditionals = formFields.filter((f) => f.conditionalOn && !fieldKeys.has(f.conditionalOn))
  const noDanglingConditionals = danglingConditionals.length === 0

  const checks: ValidationCheck[] = [
    {
      key: 'no_dangling_conditional_fields',
      label: 'Every conditional field references an existing field',
      passed: noDanglingConditionals,
      severity: 'BLOCKER',
      message: noDanglingConditionals
        ? undefined
        : `Dangling conditional reference on: ${danglingConditionals.map((f) => f.fieldKey).join(', ')}.`,
    },
  ]

  return { moduleKey: 'REGISTRATION_FORM', checks, passed: modulePassed(checks) }
}

export function validatePricingCapacity(ctx: MunValidationContext): ModuleValidationResult {
  const { registrationProducts, mun } = ctx

  const negativePrice = registrationProducts.filter((p) => p.price < 0)
  const nonPositiveCapacity = registrationProducts.filter((p) => p.capacity <= 0)
  const invalidDeadline = registrationProducts.filter(
    (p) => p.deadline != null && mun.startDate != null && p.deadline.getTime() >= mun.startDate.getTime(),
  )

  const allPricesNonNegative = negativePrice.length === 0
  const allCapacitiesPositive = nonPositiveCapacity.length === 0
  const allDeadlinesValid = invalidDeadline.length === 0

  const checks: ValidationCheck[] = [
    {
      key: 'non_negative_price',
      label: 'Every registration product has a non-negative price',
      passed: allPricesNonNegative,
      severity: 'BLOCKER',
      message: allPricesNonNegative ? undefined : `Negative price on: ${negativePrice.map((p) => p.name).join(', ')}.`,
    },
    {
      key: 'positive_capacity',
      label: 'Every registration product has a positive capacity',
      passed: allCapacitiesPositive,
      severity: 'BLOCKER',
      message: allCapacitiesPositive
        ? undefined
        : `Capacity not positive on: ${nonPositiveCapacity.map((p) => p.name).join(', ')}.`,
    },
    {
      key: 'deadline_before_start',
      label: 'Every registration product deadline (if set) is before the conference start date',
      passed: allDeadlinesValid,
      severity: 'BLOCKER',
      message: allDeadlinesValid
        ? undefined
        : `Deadline on/after conference start for: ${invalidDeadline.map((p) => p.name).join(', ')}.`,
    },
  ]

  return { moduleKey: 'PRICING_CAPACITY', checks, passed: modulePassed(checks) }
}

export function validatePaymentSettlement(ctx: MunValidationContext): ModuleValidationResult {
  const { paymentSettings, stage } = ctx

  const detailsSubmitted = paymentSettings != null
  const isVerified = paymentSettings?.verificationState === 'VERIFIED'

  const checks: ValidationCheck[] = [
    {
      key: 'payment_details_submitted',
      label: 'Payment/settlement details have been submitted',
      passed: detailsSubmitted,
      severity: 'BLOCKER',
      message: detailsSubmitted ? undefined : 'Payment settlement details are required.',
    },
    {
      // STAGE-DEPENDENT SEVERITY — READ BEFORE CHANGING.
      //
      // At SUBMIT stage this is HIGH, not BLOCKER: payment verification is
      // performed by a MUNHub admin, not the organizer (see
      // mun_payment_settings.verificationState — set only by an admin
      // action, never by the organizer's own form submission). If this were
      // BLOCKER at submit time, an organizer who has correctly filled in
      // every field would be permanently stuck unable to submit until an
      // admin manually intervenes outside the product — a deadlock the
      // organizer cannot resolve themselves. PRD §19's example UI explicitly
      // shows "🟡 Account verification pending" as a normal, expected
      // in-flight state at this point in the pipeline, not an error.
      //
      // At PUBLISH stage it becomes BLOCKER: PRD §33 requires payment
      // verification to be complete before a mun can go live, because from
      // here on real money moves through this account. This is the ONE
      // place in the whole validation engine where SUBMIT and PUBLISH
      // deliberately disagree — see design doc Section 4's closing
      // paragraph. Do NOT "fix" this into a single severity; that would
      // either deadlock every organizer at submission (if hardcoded
      // BLOCKER) or let an unverified payment account reach a published,
      // registration-accepting mun (if hardcoded HIGH). Both are bugs.
      key: 'payment_verification_state',
      label: 'Payment account has been verified by MUNHub',
      passed: isVerified,
      severity: stage === 'PUBLISH' ? 'BLOCKER' : 'HIGH',
      message: isVerified
        ? undefined
        : stage === 'PUBLISH'
          ? 'Payment account must be verified by MUNHub before this mun can be published.'
          : 'Payment account verification is pending MUNHub review. This does not block submission.',
    },
  ]

  return { moduleKey: 'PAYMENT_SETTLEMENT', checks, passed: modulePassed(checks) }
}
