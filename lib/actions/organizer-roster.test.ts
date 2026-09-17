import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munFormFields, payments, registrationProducts, studentProfiles } from '@/lib/db/schema'
import { exportDelegateRoster, getDelegateDetail, getDelegateList } from './organizer-dashboard'
import { addDelegate, makeOpsFixture, makeUser, sessionFor } from './test-fixtures/organizer-ops'

// Roster search, filters, the owner-only detail drawer and CSV export
// (lib/actions/organizer-dashboard.ts). Base list/paging/payment-filter
// coverage lives in organizer-dashboard.test.ts.

function parseCsv(csv: string): string[][] {
  // Enough for these fixtures: quoted cells never contain CRLF here.
  return csv
    .trimEnd()
    .split('\r\n')
    .map((line) => {
      const cells: string[] = []
      let cell = ''
      let quoted = false
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i]
        if (quoted) {
          if (char === '"' && line[i + 1] === '"') {
            cell += '"'
            i += 1
          } else if (char === '"') quoted = false
          else cell += char
        } else if (char === '"') quoted = true
        else if (char === ',') {
          cells.push(cell)
          cell = ''
        } else cell += char
      }
      cells.push(cell)
      return cells
    })
}

describe('roster search and filters', () => {
  it('searches the whole roster by name, email, institution or registration id, not just one page', async () => {
    const fixture = await makeOpsFixture()
    const asha = await addDelegate(fixture, { name: 'Asha Rao', institution: 'St. Francis College' })
    const kabir = await addDelegate(fixture, {
      name: 'Kabir Shah',
      email: `kabir.shah-${crypto.randomUUID()}@bits.test`,
      institution: 'BITS Hyderabad',
    })
    await addDelegate(fixture, { name: 'Meera Iyer', institution: null })
    const session = fixture.organizerSession
    const search = (term: string) =>
      getDelegateList(fixture.mun.id, { search: term, limit: 1 }, session).then((r) => ({
        ids: r.results.map((row) => row.id),
        total: r.total,
      }))

    expect(await search('asha')).toEqual({ ids: [asha.registration.id], total: 1 })
    expect(await search('KABIR.SHAH')).toEqual({ ids: [kabir.registration.id], total: 1 })
    expect(await search('francis')).toEqual({ ids: [asha.registration.id], total: 1 })
    expect(await search(kabir.registration.id.slice(0, 8))).toEqual({ ids: [kabir.registration.id], total: 1 })
    expect((await search('   ')).total).toBe(3)
    // Wildcards are literal: "%" and "_" match nothing here.
    expect((await search('%')).total).toBe(0)
    expect((await search('_')).total).toBe(0)
    // The first page holds one row, but the match count covers the roster.
    expect((await search('a')).total).toBe(3)
  })

  it('filters by registration status and by pass, alongside committee and payment', async () => {
    const fixture = await makeOpsFixture()
    const [vip] = await db
      .insert(registrationProducts)
      .values({ munId: fixture.mun.id, name: 'VIP Pass', price: 3000, capacity: 10 })
      .returning()
    const confirmed = await addDelegate(fixture, { seated: true, paymentStatus: 'PAID' })
    const attended = await addDelegate(fixture, { status: 'ATTENDED', registrationProductId: vip.id })
    await addDelegate(fixture, { status: 'CANCELLED' })
    const session = fixture.organizerSession
    const ids = (filters: Parameters<typeof getDelegateList>[1]) =>
      getDelegateList(fixture.mun.id, filters, session).then((r) => r.results.map((row) => row.id).sort())

    expect(await ids({ statuses: ['CONFIRMED', 'ATTENDED'] })).toEqual(
      [confirmed.registration.id, attended.registration.id].sort(),
    )
    expect(await ids({ statuses: [] })).toHaveLength(3)
    expect(await ids({ registrationProductId: vip.id })).toEqual([attended.registration.id])
    expect(
      await ids({ statuses: ['CONFIRMED'], committeeId: fixture.committee.id, paymentStatus: 'PAID' }),
    ).toEqual([confirmed.registration.id])
  })

  it('returns pass and portfolio columns, the MUN status, and no private registration fields', async () => {
    const fixture = await makeOpsFixture({ status: 'REGISTRATION_OPEN' })
    await addDelegate(fixture, { seated: true, formResponses: { secret: 'not in the list' } })

    const result = await getDelegateList(fixture.mun.id, undefined, fixture.organizerSession)
    expect(result.munStatus).toBe('REGISTRATION_OPEN')
    expect(result.attendanceOpen).toBe(false)
    const [row] = result.results
    expect(row.registrationProduct).toEqual({ id: fixture.pass.id, name: 'Delegate Pass', price: 1500, currency: 'INR' })
    expect(row.portfolio).toEqual({ id: fixture.portfolio.id, name: 'France' })
    expect(row).not.toHaveProperty('formResponses')
    expect(row).not.toHaveProperty('idempotencyKey')

    const active = await makeOpsFixture({ status: 'CONFERENCE_ACTIVE' })
    expect((await getDelegateList(active.mun.id, undefined, active.organizerSession)).attendanceOpen).toBe(true)
  })

  // assertOwnsOrAdmin short-circuits for staff without checking the mun
  // exists, so an admin asking for an unknown id used to read `mun.status`
  // off `undefined` and answer 500 instead of 404.
  it('answers "Mun not found" when an admin asks for an unknown mun', async () => {
    const admin = await makeUser('ADMIN')

    await expect(getDelegateList(crypto.randomUUID(), undefined, sessionFor(admin))).rejects.toThrow('Mun not found')
  })
})

describe('getDelegateDetail', () => {
  it('returns profile essentials, labelled answers in form order, payment and check-in state', async () => {
    const fixture = await makeOpsFixture()
    await db.insert(munFormFields).values([
      { munId: fixture.mun.id, fieldKey: 'diet', fieldType: 'SHORT_TEXT', label: 'Dietary needs', displayOrder: 2 },
      { munId: fixture.mun.id, fieldKey: 'grade_class', fieldType: 'SHORT_TEXT', label: 'Grade', displayOrder: 1 },
      { munId: fixture.mun.id, fieldKey: 'skipped', fieldType: 'SHORT_TEXT', label: 'Unanswered', displayOrder: 3 },
    ])
    const { user, registration } = await addDelegate(fixture, {
      name: 'Asha Rao',
      status: 'ATTENDED',
      seated: true,
      paymentStatus: 'PAID',
      formResponses: {
        diet: 'Vegetarian',
        fullName: 'Asha Rao',
        grade_class: '12',
        email: 'asha@example.com',
        skipped: '',
        legacy_key: ['a', 'b'],
      },
    })
    await db.insert(studentProfiles).values({
      userId: user.id,
      dateOfBirth: new Date('2008-04-01T00:00:00Z'),
      gradeOrYear: '12',
      residentialAddress: '1 Road',
      emergencyContactName: 'Ravi Rao',
      emergencyContactPhone: '9876543210',
      emergencyContactRelation: 'Father',
      addressCity: 'Hyderabad',
    })

    const detail = await getDelegateDetail(fixture.mun.id, registration.id, fixture.organizerSession)
    expect(detail.delegate).toMatchObject({
      name: 'Asha Rao',
      email: user.email,
      institution: 'Test University',
      profile: {
        gradeOrYear: '12',
        city: 'Hyderabad',
        emergencyContactName: 'Ravi Rao',
        emergencyContactRelation: 'Father',
        emergencyContactPhone: '9876543210',
        requiresTransportation: false,
      },
    })
    expect(detail.delegate.profile).not.toHaveProperty('residentialAddress')
    expect(detail.answers).toEqual([
      { key: 'fullName', label: 'Full name', value: 'Asha Rao' },
      { key: 'email', label: 'Email', value: 'asha@example.com' },
      { key: 'grade_class', label: 'Grade', value: '12' },
      { key: 'diet', label: 'Dietary needs', value: 'Vegetarian' },
      { key: 'legacy_key', label: 'legacy_key', value: 'a, b' },
    ])
    expect(detail.pass.name).toBe('Delegate Pass')
    expect(detail.committee?.name).toBe('UNSC')
    expect(detail.portfolio?.name).toBe('France')
    expect(detail.payment).toMatchObject({ status: 'PAID', amount: 1500 })
    expect(detail.checkIn.state).toBe('CHECKED_IN')
    expect(detail.checkIn.recordedAt).toEqual(detail.registration.updatedAt)
  })

  it('handles a delegate without a profile, payment or answers', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture)
    const detail = await getDelegateDetail(fixture.mun.id, registration.id, fixture.organizerSession)
    expect(detail.delegate.profile).toBeNull()
    expect(detail.payment).toBeNull()
    expect(detail.answers).toEqual([])
    expect(detail.accommodation).toBeNull()
    expect(detail.checkIn).toEqual({ state: 'NOT_CHECKED_IN', recordedAt: null })
  })

  it("is owner-only, and another MUN's registration reads as not found", async () => {
    const fixture = await makeOpsFixture()
    const other = await makeOpsFixture()
    const { registration } = await addDelegate(fixture)
    const { registration: foreign } = await addDelegate(other)
    const admin = await makeUser('ADMIN')

    await expect(getDelegateDetail(fixture.mun.id, registration.id, sessionFor(admin))).rejects.toThrow('Forbidden')
    await expect(getDelegateDetail(fixture.mun.id, registration.id, other.organizerSession)).rejects.toThrow(
      'Forbidden',
    )
    await expect(getDelegateDetail(fixture.mun.id, foreign.id, fixture.organizerSession)).rejects.toThrow(
      'Registration not found',
    )
  })
})

describe('exportDelegateRoster', () => {
  it('exports the filtered roster with form-field columns and neutralised formulas', async () => {
    const fixture = await makeOpsFixture()
    await db
      .insert(munFormFields)
      .values({ munId: fixture.mun.id, fieldKey: 'diet', fieldType: 'SHORT_TEXT', label: 'Dietary needs' })
    const evil = await addDelegate(fixture, {
      name: '=HYPERLINK("http://evil.test","click")',
      institution: '+cmd|calc',
      seated: true,
      paymentStatus: 'PAID',
      formResponses: { diet: '@SUM(1,2)' },
    })
    await addDelegate(fixture, { status: 'CANCELLED' })

    const result = await exportDelegateRoster(fixture.mun.id, { statuses: ['CONFIRMED'] }, fixture.organizerSession)
    expect(result.rowCount).toBe(1)
    expect(result.filename).toMatch(new RegExp(`^${fixture.mun.slug}-delegates-\\d{4}-\\d{2}-\\d{2}\\.csv$`))

    const [header, row, ...rest] = parseCsv(result.csv)
    expect(rest).toEqual([])
    expect(header).toEqual([
      'Registration ID',
      'Registration status',
      'Checked in',
      'Name',
      'Email',
      'Phone',
      'Institution',
      'Pass',
      'Committee',
      'Portfolio',
      'Payment status',
      'Amount',
      'Currency',
      'Registered at',
      'Dietary needs',
    ])
    const cell = (name: string) => row[header.indexOf(name)]
    expect(cell('Registration ID')).toBe(evil.registration.id)
    expect(cell('Name')).toBe(`'=HYPERLINK("http://evil.test","click")`)
    expect(cell('Institution')).toBe(`'+cmd|calc`)
    expect(cell('Dietary needs')).toBe(`'@SUM(1,2)`)
    expect(cell('Pass')).toBe('Delegate Pass')
    expect(cell('Committee')).toBe('UNSC')
    expect(cell('Portfolio')).toBe('France')
    expect(cell('Payment status')).toBe('PAID')
    expect(cell('Amount')).toBe('1500')
    expect(cell('Checked in')).toBe('No')
  })

  it('applies search, and exports an empty roster as a header row', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture, { name: 'Asha Rao' })
    await addDelegate(fixture, { name: 'Kabir Shah' })

    const searched = await exportDelegateRoster(fixture.mun.id, { search: 'kabir' }, fixture.organizerSession)
    expect(parseCsv(searched.csv).map((row) => row[3]).slice(1)).toEqual(['Kabir Shah'])

    const empty = await makeOpsFixture()
    const none = await exportDelegateRoster(empty.mun.id, undefined, empty.organizerSession)
    expect(none.rowCount).toBe(0)
    expect(parseCsv(none.csv)).toHaveLength(1)
  })

  it('is owner-only', async () => {
    const fixture = await makeOpsFixture()
    const admin = await makeUser('ADMIN')
    await expect(exportDelegateRoster(fixture.mun.id, undefined, sessionFor(admin))).rejects.toThrow('Forbidden')
    await expect(exportDelegateRoster(fixture.mun.id, undefined, null)).rejects.toThrow('Forbidden')
  })

  it('keeps one row per registration even with a payment row', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture)
    await db.insert(payments).values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      amount: 1500,
      status: 'FAILED',
    })
    const result = await exportDelegateRoster(fixture.mun.id, undefined, fixture.organizerSession)
    expect(result.rowCount).toBe(1)
  })
})
