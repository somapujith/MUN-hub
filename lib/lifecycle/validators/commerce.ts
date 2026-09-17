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
      // Non-blocking detail, not core "pass cost" — a deadline on/after the
      // conference start is a mistake worth flagging, but not worth blocking
      // submission over (per the minimum-required-fields cut).
      key: 'deadline_before_start',
      label: 'Every registration product deadline (if set) is before the conference start date',
      passed: allDeadlinesValid,
      severity: 'MEDIUM',
      message: allDeadlinesValid
        ? undefined
        : `Deadline on/after conference start for: ${invalidDeadline.map((p) => p.name).join(', ')}.`,
    },
  ]

  return { moduleKey: 'PRICING_CAPACITY', checks, passed: modulePassed(checks) }
}

/**
 * As of the minimum-required-fields cut, "payment is set up" means the
 * organizer's account-level UPI payout (lib/actions/organizer-onboarding.ts
 * #saveOrganizerPaymentStep, set once for the whole account during
 * onboarding) — not the legacy per-mun `mun_payment_settings` PAN/bank-account
 * form, which is no longer required to submit or publish. An organizer who
 * completed onboarding always has this set, since PAYMENT is a mandatory
 * onboarding step; this check exists mainly to catch a pre-onboarding-lock
 * legacy account.
 */
export function validatePaymentSettlement(ctx: MunValidationContext): ModuleValidationResult {
  const { organizerPaymentLinked } = ctx

  const checks: ValidationCheck[] = [
    {
      key: 'organizer_payment_linked',
      label: "Organizer's FreeCharge UPI payout details are set",
      passed: organizerPaymentLinked,
      severity: 'BLOCKER',
      message: organizerPaymentLinked
        ? undefined
        : 'Add your FreeCharge UPI payout details from your account Settings before submitting.',
    },
  ]

  return { moduleKey: 'PAYMENT_SETTLEMENT', checks, passed: modulePassed(checks) }
}
