import type { MunValidationContext, ModuleValidationResult, ValidationCheck } from '../validation'
import { modulePassed } from '../validation'
import { isDiscardedUploadUrl } from '@/lib/storage/mock-adapter'

// -----------------------------------------------------------------------------
// validators/content.ts — BASIC_INFO, DATES_VENUE, BRANDING, CONTACT
// -----------------------------------------------------------------------------
//
// Every function here is PURE: no I/O, no `await`, no `Date.now()`/`new
// Date()` — all read `ctx.now` instead. See design doc Section 4 and
// lib/lifecycle/validation.ts's module docstring for the "one batched read,
// then 15 pure functions" architecture this belongs to.
// -----------------------------------------------------------------------------

/**
 * Minimum description length for BASIC_INFO. Arbitrary but reasonable: long
 * enough to rule out placeholder text ("TBD", "test") without demanding real
 * marketing copy at this gate — organizers can (and do) polish copy after
 * onboarding. Documented here so a future reader doesn't wonder why 20.
 */
const MIN_DESCRIPTION_LENGTH = 20

export function validateBasicInfo(ctx: MunValidationContext): ModuleValidationResult {
  const { mun, organizerApplication } = ctx

  const nameNonEmpty = mun.name.trim().length > 0
  const descriptionLongEnough = (mun.description ?? '').trim().length >= MIN_DESCRIPTION_LENGTH
  const editionPresent = (mun.edition ?? '').trim().length > 0
  const organizerApproved = organizerApplication?.status === 'APPROVED'

  const checks: ValidationCheck[] = [
    {
      key: 'name_present',
      label: 'Conference name is set',
      passed: nameNonEmpty,
      severity: 'BLOCKER',
      message: nameNonEmpty ? undefined : 'Conference name is required.',
    },
    {
      key: 'description_length',
      label: `Description is at least ${MIN_DESCRIPTION_LENGTH} characters`,
      passed: descriptionLongEnough,
      severity: 'BLOCKER',
      message: descriptionLongEnough
        ? undefined
        : `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters long.`,
    },
    {
      key: 'edition_present',
      label: 'Edition is set',
      passed: editionPresent,
      severity: 'BLOCKER',
      message: editionPresent ? undefined : 'Edition (e.g. "2026") is required.',
    },
    {
      // Cross-module check per design doc Section 4: "Organizer approved"
      // reads organizerApplications.status (Gate 1) and is assigned to
      // BASIC_INFO because that's informational context on the module the
      // organizer is editing — there is nothing for the organizer to "fix"
      // here (Gate-1 approval is an admin action, not a field), so this
      // check exists to surface the fact, not to gate a fixable field. HIGH,
      // not BLOCKER: submission being blocked forever on an action only an
      // admin can take would be a deadlock, mirroring the same reasoning
      // PAYMENT_SETTLEMENT uses for its own admin-only gate (commerce.ts).
      key: 'organizer_approved',
      label: 'Organizer application has been approved (Gate 1)',
      passed: organizerApproved,
      severity: 'HIGH',
      message: organizerApproved
        ? undefined
        : 'Organizer application is not yet approved. This is informational — MUNHub must approve the organizer account; nothing on this form fixes it.',
    },
    {
      // "No duplicate active slug" (PRD Section 9): `muns.slug` already has a
      // DB-level UNIQUE constraint, so a real duplicate can never actually
      // reach this validator — the constraint fails the insert/update first.
      // This pure function has no DB access and cannot itself detect a
      // duplicate slug elsewhere; the check exists only so the module's
      // checklist has a named, readable line item for the invariant rather
      // than organizers ever seeing a raw Postgres unique-violation message.
      // It therefore passes trivially here — real duplicate detection is the
      // DB constraint's job, not this function's. See design doc Section 4.
      key: 'slug_unique',
      label: 'Conference URL is unique',
      passed: true,
      severity: 'LOW',
      message: 'Enforced by a database-level uniqueness constraint on the conference slug.',
    },
  ]

  return { moduleKey: 'BASIC_INFO', checks, passed: modulePassed(checks) }
}

export function validateDatesVenue(ctx: MunValidationContext): ModuleValidationResult {
  const { mun } = ctx

  const hasStart = mun.startDate != null
  const hasEnd = mun.endDate != null
  const endAfterStart = hasStart && hasEnd ? mun.endDate!.getTime() > mun.startDate!.getTime() : false

  const hasDeadline = mun.registrationDeadline != null
  const deadlineBeforeStart =
    hasDeadline && hasStart ? mun.registrationDeadline!.getTime() < mun.startDate!.getTime() : false

  const hasOpensAt = mun.registrationOpensAt != null
  const opensBeforeDeadline =
    hasOpensAt && hasDeadline ? mun.registrationOpensAt!.getTime() < mun.registrationDeadline!.getTime() : false

  const venuePresent = (mun.venue ?? '').trim().length > 0
  const addressPresent = (mun.addressLine1 ?? '').trim().length > 0
  const cityPresent = (mun.city ?? '').trim().length > 0
  const countryPresent = (mun.country ?? '').trim().length > 0

  const checks: ValidationCheck[] = [
    {
      key: 'end_after_start',
      label: 'End date is after start date',
      passed: hasStart && hasEnd && endAfterStart,
      severity: 'BLOCKER',
      message:
        !hasStart || !hasEnd
          ? 'Both start date and end date are required.'
          : endAfterStart
            ? undefined
            : 'End date must be after start date.',
    },
    {
      key: 'deadline_before_start',
      label: 'Registration deadline is before the conference start date',
      passed: hasDeadline && hasStart && deadlineBeforeStart,
      severity: 'BLOCKER',
      message:
        !hasDeadline || !hasStart
          ? 'Registration deadline and start date are both required.'
          : deadlineBeforeStart
            ? undefined
            : 'Registration deadline must be before the conference start date.',
    },
    {
      key: 'opens_before_deadline',
      label: 'Registration opens before the registration deadline',
      passed: hasOpensAt && hasDeadline && opensBeforeDeadline,
      severity: 'BLOCKER',
      message:
        !hasOpensAt || !hasDeadline
          ? 'Registration open date and registration deadline are both required.'
          : opensBeforeDeadline
            ? undefined
            : 'Registration open date must be before the registration deadline.',
    },
    {
      key: 'venue_present',
      label: 'Venue is set',
      passed: venuePresent,
      severity: 'BLOCKER',
      message: venuePresent ? undefined : 'Venue is required.',
    },
    {
      key: 'address_present',
      label: 'Address is set',
      passed: addressPresent,
      severity: 'BLOCKER',
      message: addressPresent ? undefined : 'Address is required.',
    },
    {
      key: 'city_present',
      label: 'City is set',
      passed: cityPresent,
      severity: 'BLOCKER',
      message: cityPresent ? undefined : 'City is required.',
    },
    {
      key: 'country_present',
      label: 'Country is set',
      passed: countryPresent,
      severity: 'BLOCKER',
      message: countryPresent ? undefined : 'Country is required.',
    },
  ]

  return { moduleKey: 'DATES_VENUE', checks, passed: modulePassed(checks) }
}

/**
 * A row whose URL points at the discarding mock store has no bytes behind it
 * (lib/storage/mock-adapter.ts). Before selectStorageAdapter() failed closed,
 * an environment with no storage binding wrote exactly such rows while
 * answering 201, so "the row exists" is not on its own proof the file does.
 */
function imageCheck(
  ctx: MunValidationContext,
  kind: 'LOGO' | 'COVER',
  key: string,
  label: string,
  noun: string,
): ValidationCheck {
  // Every row of this kind, not just the first: a re-upload after a discarded
  // one leaves both rows in context, and the module must pass once any of
  // them points at real storage.
  const rows = ctx.media.filter((m) => m.kind === kind)
  const stored = rows.some((m) => !isDiscardedUploadUrl(m.url))
  return {
    key,
    label,
    passed: stored,
    severity: 'BLOCKER',
    message: stored
      ? undefined
      : rows.length > 0
        ? `Upload your ${noun} again — the earlier upload was not stored.`
        : `A ${noun} is required.`,
  }
}

export function validateBranding(ctx: MunValidationContext): ModuleValidationResult {
  const checks: ValidationCheck[] = [
    imageCheck(ctx, 'LOGO', 'logo_present', 'Logo is uploaded', 'logo image'),
    imageCheck(ctx, 'COVER', 'cover_present', 'Cover image is uploaded', 'cover image'),
  ]

  return { moduleKey: 'BRANDING', checks, passed: modulePassed(checks) }
}

export function validateContact(ctx: MunValidationContext): ModuleValidationResult {
  const { contact } = ctx

  const emailPresent = (contact?.officialEmail ?? '').trim().length > 0
  const phonePresent = (contact?.phone ?? '').trim().length > 0
  const contactPersonPresent = (contact?.contactPersonName ?? '').trim().length > 0

  const checks: ValidationCheck[] = [
    {
      key: 'official_email_present',
      label: 'Official email is set',
      passed: emailPresent,
      severity: 'BLOCKER',
      message: emailPresent ? undefined : 'Official email is required.',
    },
    {
      key: 'phone_present',
      label: 'Phone number is set',
      passed: phonePresent,
      severity: 'BLOCKER',
      message: phonePresent ? undefined : 'Phone number is required.',
    },
    {
      key: 'contact_person_name_present',
      label: 'Contact person name is set',
      passed: contactPersonPresent,
      severity: 'BLOCKER',
      message: contactPersonPresent ? undefined : 'Contact person name is required.',
    },
  ]

  return { moduleKey: 'CONTACT', checks, passed: modulePassed(checks) }
}
