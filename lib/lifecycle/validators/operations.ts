import type { MunValidationContext, ModuleValidationResult, ValidationCheck } from '../validation'
import { modulePassed } from '../validation'
import type { MunDocumentKind } from '@/lib/db/schema-enums'
import { isDiscardedUploadUrl } from '@/lib/storage/mock-adapter'

// -----------------------------------------------------------------------------
// validators/operations.ts — RULES_DOCUMENTS, SCHEDULE, ACCOMMODATION,
// FINAL_REVIEW
// -----------------------------------------------------------------------------
// Pure functions — see validators/content.ts's header comment for the shared
// architecture note (no I/O, no await, no direct clock reads).
// -----------------------------------------------------------------------------

// MUN Hub has no refunds, so a refund policy is not a required document.
const REQUIRED_DOCUMENTS: { kind: MunDocumentKind; label: string }[] = [
  { kind: 'RULES', label: 'Rules of procedure' },
  { kind: 'CODE_OF_CONDUCT', label: 'Code of conduct' },
]

export function validateRulesDocuments(ctx: MunValidationContext): ModuleValidationResult {
  // A row whose URL points at the discarding mock store has no bytes behind
  // it (lib/storage/mock-adapter.ts), so it does not count as uploaded — a
  // delegate following the link would get a not-found page, not the PDF.
  const storedKinds = new Set(ctx.documents.filter((d) => !isDiscardedUploadUrl(d.url)).map((d) => d.kind))
  const rowKinds = new Set(ctx.documents.map((d) => d.kind))
  const missing = REQUIRED_DOCUMENTS.filter((doc) => !storedKinds.has(doc.kind))
  const allPresent = missing.length === 0
  const someDiscarded = missing.some((doc) => rowKinds.has(doc.kind))

  // Non-blocking as of the minimum-required-fields cut — documents can be
  // uploaded any time after publishing.
  const checks: ValidationCheck[] = [
    {
      key: 'required_documents_present',
      label: 'Rules of procedure and code of conduct are uploaded',
      passed: allPresent,
      severity: 'MEDIUM',
      message: allPresent
        ? undefined
        : `Upload your ${missing.map((doc) => doc.label.toLowerCase()).join(' and ')}${
            someDiscarded ? ' again — the earlier upload was not stored' : ''
          }.`,
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

  // Non-blocking as of the minimum-required-fields cut — the schedule can be
  // built any time after publishing.
  const checks: ValidationCheck[] = [
    {
      key: 'at_least_one_schedule_item',
      label: 'At least one schedule item exists',
      passed: hasAtLeastOneItem,
      severity: 'MEDIUM',
      message: hasAtLeastOneItem ? undefined : 'At least one schedule item is recommended.',
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

  // Non-blocking as of the minimum-required-fields cut — accommodation can
  // be configured any time after publishing.
  const checks: ValidationCheck[] = [
    {
      key: 'at_least_one_active_option',
      label: 'At least one active accommodation option exists',
      passed: hasActiveOption,
      severity: 'MEDIUM',
      message: hasActiveOption
        ? undefined
        : 'At least one active accommodation option is recommended (or mark accommodation as not provided).',
    },
    {
      key: 'every_option_has_price',
      label: 'Every active accommodation option has a price',
      passed: allPriced,
      severity: 'MEDIUM',
      message: allPriced ? undefined : `Missing price on: ${optionsMissingPrice.map((o) => o.name).join(', ')}.`,
    },
    {
      key: 'every_option_has_capacity',
      label: 'Every active accommodation option has a capacity',
      passed: allCapacitySet,
      severity: 'MEDIUM',
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
