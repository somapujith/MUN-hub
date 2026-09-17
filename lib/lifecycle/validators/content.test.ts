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

  it('flags (but does not block on) a description under the minimum length', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: 'too short', edition: '2027' } })
    const result = validateBasicInfo(ctx)
    const check = result.checks.find((c) => c.key === 'description_length')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('flags (but does not block on) a null description', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: null, edition: '2027' } })
    const result = validateBasicInfo(ctx)
    expect(result.checks.find((c) => c.key === 'description_length')?.passed).toBe(false)
    expect(result.passed).toBe(true)
  })

  it('flags (but does not block on) an empty edition', () => {
    const ctx = makeContext({ mun: { name: 'Test MUN', description: 'A'.repeat(25), edition: '' } })
    const result = validateBasicInfo(ctx)
    const check = result.checks.find((c) => c.key === 'edition_present')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
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

  it('fails (BLOCKER on city only) when venue, address, city, or country are missing', () => {
    const ctx = makeContext({ mun: { ...validDates, venue: null, addressLine1: null, city: null, country: null } })
    const result = validateDatesVenue(ctx)
    // city is the only one of these four still BLOCKER — venue/address/country
    // are non-blocking as of the minimum-required-fields cut.
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'venue_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'venue_present')?.severity).toBe('MEDIUM')
    expect(result.checks.find((c) => c.key === 'address_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'address_present')?.severity).toBe('MEDIUM')
    expect(result.checks.find((c) => c.key === 'city_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'city_present')?.severity).toBe('BLOCKER')
    expect(result.checks.find((c) => c.key === 'country_present')?.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'country_present')?.severity).toBe('MEDIUM')
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

  it('flags (but does not block on) a missing LOGO', () => {
    const ctx = makeContext({ media: [{ kind: 'COVER' } as never] })
    const result = validateBranding(ctx)
    const check = result.checks.find((c) => c.key === 'logo_present')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('flags (but does not block on) a missing COVER', () => {
    const ctx = makeContext({ media: [{ kind: 'LOGO' } as never] })
    const result = validateBranding(ctx)
    const check = result.checks.find((c) => c.key === 'cover_present')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('still passes (non-blocking) when media is empty', () => {
    const ctx = makeContext({ media: [] })
    const result = validateBranding(ctx)
    expect(result.passed).toBe(true)
  })

  // Rows written while no storage backend was configured point at the mock
  // store, which kept no bytes — the row exists but the image does not.
  it('flags (but does not block on) rows that only point at the discarding mock store', () => {
    const ctx = makeContext({
      media: [
        { kind: 'LOGO', url: '/mock-storage/muns/mun-1/branding/a' } as never,
        { kind: 'COVER', url: '/mock-storage/muns/mun-1/branding/b' } as never,
      ],
    })
    const result = validateBranding(ctx)
    expect(result.passed).toBe(true)
    const logo = result.checks.find((c) => c.key === 'logo_present')
    expect(logo?.passed).toBe(false)
    expect(logo?.message).toContain('again')
    expect(result.checks.find((c) => c.key === 'cover_present')?.passed).toBe(false)
  })

  it('passes for real stored URLs', () => {
    const ctx = makeContext({
      media: [
        { kind: 'LOGO', url: 'https://api.munhub.in/api/v1/files/muns/mun-1/branding/a' } as never,
        { kind: 'COVER', url: 'https://api.munhub.in/api/v1/files/muns/mun-1/branding/b' } as never,
      ],
    })
    expect(validateBranding(ctx).passed).toBe(true)
  })

  it('passes once a stored logo sits next to a lost one', () => {
    const ctx = makeContext({
      media: [
        { kind: 'LOGO', url: '/mock-storage/muns/mun-1/branding/a' } as never,
        { kind: 'LOGO', url: 'https://api.munhub.in/api/v1/files/muns/mun-1/branding/c' } as never,
        { kind: 'COVER', url: 'https://api.munhub.in/api/v1/files/muns/mun-1/branding/d' } as never,
      ],
    })
    expect(validateBranding(ctx).passed).toBe(true)
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

  it('flags (but does not block on) a null contact (nothing submitted)', () => {
    const ctx = makeContext({ contact: null })
    const result = validateContact(ctx)
    expect(result.passed).toBe(true)
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
