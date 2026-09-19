import type { MunModule } from '@/lib/db/schema-enums'

// -----------------------------------------------------------------------------
// High-impact modules
// -----------------------------------------------------------------------------
//
// NO RE-VERIFICATION AFTER VERIFIED (product decision, 2026-09-19): once a MUN
// has passed verification, organizers can change anything on it — dates,
// venue, prices, committees, documents — without it going back to review or
// coming off the marketplace. This file used to hold the trigger that did
// that (`triggerReverificationIfNeeded`/`forceReverification`); it was
// removed on that decision. Do not add it back without asking.
//
// What is left here is only the list of high-impact fields, which still
// decides which modules are frozen (LOCKED) while a MUN is under its FIRST
// review — see `assertModuleNotLocked` in module-completion.ts. The filename
// is kept so existing imports don't churn.
//
// Payout details are the one thing that still gets re-checked, and that lives
// in payment-settlement.ts: changing the bank account resets
// `mun_payment_settings.verificationState` to PENDING so an admin re-verifies
// it before registration can open. It never takes the MUN offline.

/**
 * High-impact fields per module. Exhaustive `Record<MunModule, string[]>` —
 * every one of the 19 `MunModule` enum values (15 PRD-key tracked modules + 4
 * legacy pre-PRD keys) MUST have an entry, even if that entry is `[]`, so
 * adding a module key without deciding whether it is high-impact is a compile
 * error rather than a silent gap.
 *
 * `BRANDING`/`REGISTRATION_FORM`/`FINAL_REVIEW` are deliberately `[]` so they
 * stay editable while a MUN is under review (a bad logo should be easy to fix).
 *
 * A module whose list is non-empty is exactly a module organizers may not
 * edit while the MUN is in its first review (see `isHighImpactModule`).
 */
const HIGH_IMPACT_FIELDS: Record<MunModule, string[]> = {
  BASIC_INFO: ['name', 'edition'],
  // The whole public "where" block, not just venue/city — the public MUN page
  // shows the street address and links out to `mapUrl`.
  //
  // `registrationOpensAt` is deliberately NOT here even though
  // `registrationDeadline` is: registration-lifecycle.ts tells an organizer
  // whose live MUN hasn't opened yet to "move the opening date in Setup to
  // open it sooner", so that edit must never be locked.
  DATES_VENUE: [
    'startDate',
    'endDate',
    'venue',
    'addressLine1',
    'addressState',
    'postalCode',
    'city',
    'country',
    'mapUrl',
    'registrationDeadline',
  ],
  BRANDING: [],
  COMMITTEES: ['name', 'capacity', 'agenda'],
  PORTFOLIOS: ['name', 'availability'],
  EXECUTIVE_BOARD: ['name', 'role', 'committeeId'],
  REGISTRATION_TYPES: ['name', 'registrationType', 'status'],
  REGISTRATION_FORM: [],
  PRICING_CAPACITY: ['price', 'capacity', 'deadline', 'earlyBirdPrice', 'earlyBirdDeadline'],
  PAYMENT_SETTLEMENT: [
    'accountNumberLast4',
    'ifsc',
    'legalName',
    'panLast4',
    'refundPolicy',
    'gateway',
    'currency',
  ],
  RULES_DOCUMENTS: ['url'],
  SCHEDULE: ['startsAt', 'endsAt'],
  ACCOMMODATION: ['price', 'capacity', 'name', 'status', 'accommodationProvided'],
  CONTACT: ['officialEmail', 'phone'],
  FINAL_REVIEW: [],
  // Legacy pre-PRD keys (retained, remapped via drizzle/0010) — kept
  // resolving to empty lists so old rows/tests still work, not deleted.
  mun_details: [],
  committees: [],
  portfolios: [],
  registration_products: [],
}

/**
 * True iff `moduleName` has a non-empty `HIGH_IMPACT_FIELDS` list — i.e. it
 * is one of the modules `assertModuleNotLocked` (module-completion.ts)
 * enforces LOCKED-state edit rejection for during active review. Exported
 * so the locking logic has one source of truth for "which modules count as
 * high-impact".
 */
export function isHighImpactModule(moduleName: MunModule): boolean {
  return (HIGH_IMPACT_FIELDS[moduleName] ?? []).length > 0
}
