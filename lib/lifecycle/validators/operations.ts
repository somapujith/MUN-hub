import type { MunValidationContext, ModuleValidationResult, ValidationCheck } from '../validation'
import { modulePassed } from '../validation'
import type { MunDocumentKind } from '@/lib/db/schema-enums'

// -----------------------------------------------------------------------------
// validators/operations.ts — RULES_DOCUMENTS, SCHEDULE, ACCOMMODATION,
// FINAL_REVIEW
// -----------------------------------------------------------------------------
// Pure functions — see validators/content.ts's header comment for the shared
// architecture note (no I/O, no await, no direct clock reads).
// -----------------------------------------------------------------------------

const REQUIRED_DOCUMENT_KINDS: MunDocumentKind[] = ['RULES', 'CODE_OF_CONDUCT', 'REFUND_POLICY']

export function validateRulesDocuments(ctx: MunValidationContext): ModuleValidationResult {
  const presentKinds = new Set(ctx.documents.map((d) => d.kind))
  const missingKinds = REQUIRED_DOCUMENT_KINDS.filter((kind) => !presentKinds.has(kind))
  const allPresent = missingKinds.length === 0

  const checks: ValidationCheck[] = [
    {
      key: 'required_documents_present',
      label: 'Rules, Code of Conduct, and Refund Policy documents are all uploaded',
      passed: allPresent,
      severity: 'BLOCKER',
      message: allPresent ? undefined : `Missing document(s): ${missingKinds.join(', ')}.`,
    },
  ]

  return { moduleKey: 'RULES_DOCUMENTS', checks, passed: modulePassed(checks) }
}

/**
 * Minimal per design doc Section 4 / task brief: beyond "at least one
 * schedule item exists," nothing more specific is called out for SCHEDULE.
 */
export function validateSchedule(ctx: MunValidationContext): ModuleValidationResult {
  const hasAtLeastOneItem = ctx.scheduleItems.length > 0

  const checks: ValidationCheck[] = [
    {
      key: 'at_least_one_schedule_item',
      label: 'At least one schedule item exists',
      passed: hasAtLeastOneItem,
      severity: 'BLOCKER',
      message: hasAtLeastOneItem ? undefined : 'At least one schedule item is required.',
    },
  ]

  return { moduleKey: 'SCHEDULE', checks, passed: modulePassed(checks) }
}

export function validateAccommodation(ctx: MunValidationContext): ModuleValidationResult {
  const { mun, accommodationOptions } = ctx

  // PRD §22's explicit opt-out: an organizer who has answered "we are not
  // providing accommodation" has fully satisfied this module by that answer
  // alone — there is nothing further to validate. Trivial pass, zero checks
  // withheld (the single check below reports passed:true so the checklist
  // still shows a named, green line item rather than an empty module).
  if (mun.accommodationProvided === 'NOT_PROVIDED') {
    const checks: ValidationCheck[] = [
      {
        key: 'accommodation_not_provided_opt_out',
        label: 'Accommodation is explicitly marked as not provided',
        passed: true,
        severity: 'BLOCKER',
      },
    ]
    return { moduleKey: 'ACCOMMODATION', checks, passed: modulePassed(checks) }
  }

  const activeOptions = accommodationOptions.filter((o) => o.status === 'active')
  const hasActiveOption = activeOptions.length > 0
  const optionsMissingPrice = activeOptions.filter((o) => o.price == null || o.price < 0)
  const optionsMissingCapacity = activeOptions.filter((o) => o.capacity == null || o.capacity <= 0)

  const allPriced = optionsMissingPrice.length === 0
  const allCapacitySet = optionsMissingCapacity.length === 0

  const checks: ValidationCheck[] = [
    {
      key: 'at_least_one_active_option',
      label: 'At least one active accommodation option exists',
      passed: hasActiveOption,
      severity: 'BLOCKER',
      message: hasActiveOption
        ? undefined
        : 'At least one active accommodation option is required (or mark accommodation as not provided).',
    },
    {
      key: 'every_option_has_price',
      label: 'Every active accommodation option has a price',
      passed: allPriced,
      severity: 'BLOCKER',
      message: allPriced ? undefined : `Missing price on: ${optionsMissingPrice.map((o) => o.name).join(', ')}.`,
    },
    {
      key: 'every_option_has_capacity',
      label: 'Every active accommodation option has a capacity',
      passed: allCapacitySet,
      severity: 'BLOCKER',
      message: allCapacitySet
        ? undefined
        : `Missing capacity on: ${optionsMissingCapacity.map((o) => o.name).join(', ')}.`,
    },
  ]

  return { moduleKey: 'ACCOMMODATION', checks, passed: modulePassed(checks) }
}

/**
 * FINAL_REVIEW doesn't validate its own data — it aggregates a cross-cutting
 * check per design doc Section 4: zero unresolved BLOCKER-severity issues
 * anywhere on the mun. Assigned here since this is the last gate before
 * submission, per the brief's "assign to whichever module the organizer must
 * edit to fix it" rule read in aggregate form — there is no single owning
 * module for "any blocker anywhere," so it lands on the final gate.
 */
export function validateFinalReview(ctx: MunValidationContext): ModuleValidationResult {
  const unresolvedBlockers = ctx.unresolvedIssues.filter((issue) => issue.severity === 'BLOCKER')
  const zeroUnresolvedBlockers = unresolvedBlockers.length === 0

  const checks: ValidationCheck[] = [
    {
      key: 'zero_unresolved_blocker_issues',
      label: 'No unresolved BLOCKER-severity issues remain',
      passed: zeroUnresolvedBlockers,
      severity: 'BLOCKER',
      message: zeroUnresolvedBlockers
        ? undefined
        : `${unresolvedBlockers.length} unresolved blocker issue(s) remain.`,
    },
  ]

  return { moduleKey: 'FINAL_REVIEW', checks, passed: modulePassed(checks) }
}
