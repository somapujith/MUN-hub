import type { MunModule } from '@/lib/db/schema-enums'
import type { MunValidationContext, ModuleValidationResult } from './validation'
import { validateBasicInfo, validateDatesVenue, validateBranding, validateContact } from './validators/content'
import { validateCommittees, validatePortfolios, validateExecutiveBoard } from './validators/committees'
import {
  validateRegistrationTypes,
  validateRegistrationForm,
  validatePricingCapacity,
  validatePaymentSettlement,
} from './validators/commerce'
import { validateRulesDocuments, validateSchedule, validateAccommodation, validateFinalReview } from './validators/operations'

/**
 * Static registry of the 15 PRD Section 38 module keys, generalizing the
 * old hardcoded 4-element `TRACKED_MODULES` array in module-verification.ts.
 *
 * Per design doc Section 2.4: a static code registry, not a DB-configured
 * module list — `validate` is code, so the registry can't live purely in the
 * DB anyway. Per-mun overrides of `isRequired` are genuinely data and live
 * on `mun_module_verifications` instead (see `setModuleRequirement` in
 * module-verification.ts).
 *
 * `validate` (Task 9) is a PURE function — no I/O, no await, no direct clock
 * reads — over a `MunValidationContext` loaded once by
 * `lib/lifecycle/validation.ts#loadValidationContext`. See that file and
 * lib/lifecycle/validators/*.ts for the full engine.
 */
export interface ModuleDefinition {
  key: MunModule
  label: string
  defaultRequired: boolean
  phase: 'CONTENT' | 'COMMERCE' | 'OPERATIONS' | 'FINAL'
  validate: (ctx: MunValidationContext) => ModuleValidationResult
}

// Minimum-required-fields cut (per user direction): only BASIC_INFO (name),
// DATES_VENUE (dates + city), COMMITTEES (at least one), REGISTRATION_TYPES
// and PRICING_CAPACITY (at least one priced pass), and PAYMENT_SETTLEMENT
// (organizer's account-level UPI payout) are `defaultRequired: true` — every
// BLOCKER check within those modules' validators is genuinely required to
// submit. Every other module is `defaultRequired: false` and its checks have
// been demoted off BLOCKER severity (see validators/*.ts) so they cannot
// block submission or publish either — `defaultRequired` alone only affects
// the UI's "required" grouping/progress math (go-live-checklist.tsx), NOT
// the actual gate in validation.ts#validateMunForSubmission, which always
// runs every module's validate() regardless of this flag.
export const MODULE_REGISTRY: ModuleDefinition[] = [
  { key: 'BASIC_INFO', label: 'Basic Info', defaultRequired: true, phase: 'CONTENT', validate: validateBasicInfo },
  { key: 'DATES_VENUE', label: 'Dates & Venue', defaultRequired: true, phase: 'CONTENT', validate: validateDatesVenue },
  { key: 'BRANDING', label: 'Branding', defaultRequired: false, phase: 'CONTENT', validate: validateBranding },
  { key: 'COMMITTEES', label: 'Committees', defaultRequired: true, phase: 'CONTENT', validate: validateCommittees },
  { key: 'PORTFOLIOS', label: 'Portfolios', defaultRequired: false, phase: 'CONTENT', validate: validatePortfolios },
  {
    key: 'EXECUTIVE_BOARD',
    label: 'Executive Board',
    defaultRequired: false,
    phase: 'CONTENT',
    validate: validateExecutiveBoard,
  },
  { key: 'CONTACT', label: 'Contact', defaultRequired: false, phase: 'CONTENT', validate: validateContact },

  {
    key: 'REGISTRATION_TYPES',
    label: 'Registration Types',
    defaultRequired: true,
    phase: 'COMMERCE',
    validate: validateRegistrationTypes,
  },
  {
    key: 'REGISTRATION_FORM',
    label: 'Registration Form',
    defaultRequired: false,
    phase: 'COMMERCE',
    validate: validateRegistrationForm,
  },
  {
    key: 'PRICING_CAPACITY',
    label: 'Pricing & Capacity',
    defaultRequired: true,
    phase: 'COMMERCE',
    validate: validatePricingCapacity,
  },
  {
    key: 'PAYMENT_SETTLEMENT',
    label: 'Payment Settlement',
    defaultRequired: true,
    phase: 'COMMERCE',
    validate: validatePaymentSettlement,
  },

  {
    key: 'RULES_DOCUMENTS',
    label: 'Rules & Documents',
    defaultRequired: false,
    phase: 'OPERATIONS',
    validate: validateRulesDocuments,
  },
  { key: 'SCHEDULE', label: 'Schedule', defaultRequired: false, phase: 'OPERATIONS', validate: validateSchedule },
  {
    key: 'ACCOMMODATION',
    label: 'Accommodation',
    defaultRequired: false,
    phase: 'OPERATIONS',
    validate: validateAccommodation,
  },

  { key: 'FINAL_REVIEW', label: 'Final Review', defaultRequired: true, phase: 'FINAL', validate: validateFinalReview },
]

/** `MODULE_REGISTRY.map(m => m.key)` — the set of module keys the verification engine tracks. */
export const TRACKED_MODULES: MunModule[] = MODULE_REGISTRY.map((m) => m.key)

/**
 * Looks up a module's static definition. Throws if `key` isn't in the
 * registry — every module key should always resolve; a miss is a real bug
 * (e.g. a legacy pre-PRD key like `mun_details` being passed where a PRD
 * key was expected), not a case to silently paper over.
 */
export function getModuleDefinition(key: MunModule): ModuleDefinition {
  const def = MODULE_REGISTRY.find((m) => m.key === key)
  if (!def) {
    throw new Error(`No ModuleDefinition registered for module key "${key}"`)
  }
  return def
}
