import { describe, it, expect } from 'vitest'
import { validateBasicInfo, validateDatesVenue, validateBranding, validateContact } from './content'
import { makeContext } from './test-helpers'

describe('validateBasicInfo', () => {
  it('passes when name, description (>=20 chars), edition are set and organizer is approved', () => {
    const ctx = makeContext({
      mun: { name: 'Test MUN', description: 'A'.repeat(25), edition: '2027' },
      organizerApplication: { status: 'APPROVED' } as never,
    })
    const result = validateBasicInfo(ctx)
    expect(result.moduleKey).toBe('BASIC_INFO')
    expect(result.passed).toBe(true)
    expect(result.checks.find((c) => c.key === 'name_present')?.passed).toBe(true)
    expect(result.checks.find((c) => c.key === 'description_length')?.passed).toBe(true)
    expect(result.checks.find((c) => c.key === 'edition_present')?.passed).toBe(true)
  })

  it('fails (BLOCKER) when name is empty', () => {
    const ctx = makeContext({ mun: { name: '  ', description: 'A'.repeat(25), edition: '2027' } })
    const result = validateBasicInfo(ctx)
    expect(result.passed).toBe(false)
    const check = result.checks.find((c) => c.key === 'name_present')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('BLOCKER')
  })

  it('fails (BLOCKER) when description is under the minimum length', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: 'too short', edition: '2027' } })
    const result = validateBasicInfo(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'description_length')?.passed).toBe(false)
  })

  it('fails (BLOCKER) when description is null', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: null, edition: '2027' } })
    const result = validateBasicInfo(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'description_length')?.passed).toBe(false)
  })

  it('fails (BLOCKER) when edition is empty', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: 'A'.repeat(25), edition: '' } })
    const result = validateBasicInfo(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'edition_present')?.passed).toBe(false)
  })

  it('organizer-not-approved is HIGH severity, not BLOCKER — does not fail the module', () => {
    const ctx = makeContext({
      mun: { name: 'Test MUN', description: 'A'.repeat(25), edition: '2027' },
      organizerApplication: { status: 'SUBMITTED' } as never,
    })
    const result = validateBasicInfo(ctx)
    const check = result.checks.find((c) => c.key === 'organizer_approved')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('HIGH')
    // Module still passes overall since this is the only failing check and it's not a BLOCKER.
    expect(result.passed).toBe(true)
  })

  it('organizer-not-approved when organizerApplication is null', () => {
    const ctx = makeContext({
      mun: { name: 'Test MUN', description: 'A'.repeat(25), edition: '2027' },
      organizerApplication: null,
    })
    const result = validateBasicInfo(ctx)
    expect(result.checks.find((c) => c.key === 'organizer_approved')?.passed).toBe(false)
  })

  it('slug_unique always passes trivially (real detection is a DB constraint, not this pure function)', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: 'A'.repeat(25), edition: '2027' } })
    const result = validateBasicInfo(ctx)
    expect(result.checks.find((c) => c.key === 'slug_unique')?.passed).toBe(true)
  })
})

describe('validateDatesVenue', () => {
  const validDates = {
    startDate: new Date('2027-06-10T00:00:00Z'),
    endDate: new Date('2027-06-12T00:00:00Z'),
    registrationOpensAt: new Date('2027-01-01T00:00:00Z'),
    registrationDeadline: new Date('2027-06-01T00:00:00Z'),
    venue: 'Grand Hall',
    addressLine1: '123 Main St',
    city: 'Hyderabad',
    country: 'India',
  }

  it('passes when all date orderings and location fields are valid', () => {
    const ctx = makeContext({ mun: validDates })
    const result = validateDatesVenue(ctx)
    expect(result.passed).toBe(true)
    expect(result.moduleKey).toBe('DATES_VENUE')
  })

  it('fails when endDate is before startDate', () => {
    const ctx = makeContext({
      mun: { ...validDates, startDate: new Date('2027-06-12T00:00:00Z'), endDate: new Date('2027-06-10T00:00:00Z') },
    })
    const result = validateDatesVenue(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'end_after_start')?.passed).toBe(false)
  })

  it('fails when endDate equals startDate (not strictly after)', () => {
    const sameDate = new Date('2027-06-10T00:00:00Z')
    const ctx = makeContext({ mun: { ...validDates, startDate: sameDate, endDate: sameDate } })
    const result = validateDatesVenue(ctx)
    expect(result.checks.find((c) => c.key === 'end_after_start')?.passed).toBe(false)
  })

  it('fails when registrationDeadline is after startDate', () => {
    const ctx = makeContext({
      mun: { ...validDates, registrationDeadline: new Date('2027-07-01T00:00:00Z') },
    })
    const result = validateDatesVenue(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'deadline_before_start')?.passed).toBe(false)
  })

  it('fails when registrationOpensAt is after registrationDeadline', () => {
    const ctx = makeContext({
      mun: { ...validDates, registrationOpensAt: new Date('2027-06-05T00:00:00Z') },
    })
    const result = validateDatesVenue(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'opens_before_deadline')?.passed).toBe(false)
  })

  it('fails when venue, address, city, or country are missing', () => {
    const ctx = makeContext({ mun: { ...validDates, venue: null, addressLine1: null, city: null, country: null } })
    const result = validateDatesVenue(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'venue_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'address_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'city_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'country_present')?.passed).toBe(false)
  })

  it('fails all date checks when dates are null', () => {
    const ctx = makeContext({
      mun: { ...validDates, startDate: null, endDate: null, registrationOpensAt: null, registrationDeadline: null },
    })
    const result = validateDatesVenue(ctx)
    expect(result.checks.find((c) => c.key === 'end_after_start')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'deadline_before_start')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'opens_before_deadline')?.passed).toBe(false)
  })
})

describe('validateBranding', () => {
  it('passes when at least one LOGO and one COVER media row exist', () => {
    const ctx = makeContext({
      media: [{ kind: 'LOGO' } as never, { kind: 'COVER' } as never],
    })
    const result = validateBranding(ctx)
    expect(result.passed).toBe(true)
    expect(result.moduleKey).toBe('BRANDING')
  })

  it('fails when no LOGO exists', () => {
    const ctx = makeContext({ media: [{ kind: 'COVER' } as never] })
    const result = validateBranding(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'logo_present')?.passed).toBe(false)
  })

  it('fails when no COVER exists', () => {
    const ctx = makeContext({ media: [{ kind: 'LOGO' } as never] })
    const result = validateBranding(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'cover_present')?.passed).toBe(false)
  })

  it('fails when media is empty', () => {
    const ctx = makeContext({ media: [] })
    const result = validateBranding(ctx)
    expect(result.passed).toBe(false)
  })
})

describe('validateContact', () => {
  it('passes when officialEmail, phone, and contactPersonName are all set', () => {
    const ctx = makeContext({
      contact: { officialEmail: 'a@b.com', phone: '123', contactPersonName: 'Jane' } as never,
    })
    const result = validateContact(ctx)
    expect(result.passed).toBe(true)
    expect(result.moduleKey).toBe('CONTACT')
  })

  it('fails when contact is null (nothing submitted)', () => {
    const ctx = makeContext({ contact: null })
    const result = validateContact(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'official_email_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'phone_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'contact_person_name_present')?.passed).toBe(false)
  })

  it('fails when officialEmail is missing', () => {
    const ctx = makeContext({ contact: { officialEmail: '', phone: '123', contactPersonName: 'Jane' } as never })
    const result = validateContact(ctx)
    expect(result.checks.find((c) => c.key === 'official_email_present')?.passed).toBe(false)
  })

  it('fails when phone is missing', () => {
    const ctx = makeContext({ contact: { officialEmail: 'a@b.com', phone: null, contactPersonName: 'Jane' } as never })
    const result = validateContact(ctx)
    expect(result.checks.find((c) => c.key === 'phone_present')?.passed).toBe(false)
  })

  it('fails when contactPersonName is missing', () => {
    const ctx = makeContext({ contact: { officialEmail: 'a@b.com', phone: '123', contactPersonName: '' } as never })
    const result = validateContact(ctx)
    expect(result.checks.find((c) => c.key === 'contact_person_name_present')?.passed).toBe(false)
  })
})
