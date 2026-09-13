import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from './client'
import {
  muns,
  users,
  committees,
  munModuleVerifications,
  munMedia,
  munExecutiveBoard,
  munFormFields,
  munPaymentSettings,
  munDocuments,
  munScheduleItems,
  munContacts,
} from './schema'

describe('pipeline schema (Task 3: completion axis + unique constraints)', () => {
  it('rejects a second mun_module_verifications row with the same (munId, moduleName)', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Uq Test Mun', slug: `uq-test-${Date.now()}-${Math.random()}` })
      .returning()

    await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'COMMITTEES', state: 'NOT_SUBMITTED' })

    await expect(
      db.insert(munModuleVerifications).values({
        munId: mun.id,
        moduleName: 'COMMITTEES',
        state: 'NOT_SUBMITTED',
      }),
    ).rejects.toThrow()
  })

  it('allows the same moduleName across two different muns (constraint is per-mun, not global)', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org2', email: `org2-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [munA] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Mun A', slug: `mun-a-${Date.now()}-${Math.random()}` })
      .returning()
    const [munB] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Mun B', slug: `mun-b-${Date.now()}-${Math.random()}` })
      .returning()

    const [rowA] = await db
      .insert(munModuleVerifications)
      .values({ munId: munA.id, moduleName: 'BASIC_INFO', state: 'NOT_SUBMITTED' })
      .returning()
    const [rowB] = await db
      .insert(munModuleVerifications)
      .values({ munId: munB.id, moduleName: 'BASIC_INFO', state: 'NOT_SUBMITTED' })
      .returning()

    expect(rowA.moduleName).toBe('BASIC_INFO')
    expect(rowB.moduleName).toBe('BASIC_INFO')
  })

  it('mun_module_verifications completion-axis columns default correctly and round-trip', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org3', email: `org3-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Completion Mun', slug: `completion-mun-${Date.now()}-${Math.random()}` })
      .returning()

    const [row] = await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'PORTFOLIOS', state: 'NOT_SUBMITTED' })
      .returning()

    expect(row.completionStatus).toBe('NOT_STARTED')
    expect(row.isRequired).toBe(true)
    expect(row.completionPercentage).toBe(0)
    expect(row.blockingIssueCount).toBe(0)
    expect(row.lastComputedAt).toBeNull()
    expect(row.completedAt).toBeNull()

    const now = new Date()
    const [updated] = await db
      .update(munModuleVerifications)
      .set({
        completionStatus: 'COMPLETE',
        isRequired: false,
        completionPercentage: 100,
        blockingIssueCount: 0,
        lastComputedAt: now,
        completedAt: now,
      })
      .where(eq(munModuleVerifications.id, row.id))
      .returning()

    expect(updated.completionStatus).toBe('COMPLETE')
    expect(updated.isRequired).toBe(false)
    expect(updated.completionPercentage).toBe(100)
    expect(updated.lastComputedAt?.toISOString()).toBe(now.toISOString())
    expect(updated.completedAt?.toISOString()).toBe(now.toISOString())
  })

  it('muns table round-trips the new PRD Section 9/10/22 columns', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org4', email: `org4-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const registrationOpensAt = new Date('2027-01-01T10:00:00Z')
    const registrationDeadline = new Date('2027-02-01T18:00:00Z')

    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Full Columns Mun',
        slug: `full-columns-mun-${Date.now()}-${Math.random()}`,
        conferenceType: 'IN_PERSON',
        targetParticipantType: 'UNIVERSITY',
        addressLine1: '123 Diplomat Lane',
        addressState: 'Telangana',
        postalCode: '500032',
        mapUrl: 'https://maps.example.com/mun',
        registrationOpensAt,
        registrationDeadline,
        accommodationProvided: 'PROVIDED',
      })
      .returning()

    expect(mun.conferenceType).toBe('IN_PERSON')
    expect(mun.targetParticipantType).toBe('UNIVERSITY')
    expect(mun.addressLine1).toBe('123 Diplomat Lane')
    expect(mun.addressState).toBe('Telangana')
    expect(mun.postalCode).toBe('500032')
    expect(mun.mapUrl).toBe('https://maps.example.com/mun')
    expect(mun.registrationOpensAt?.toISOString()).toBe(registrationOpensAt.toISOString())
    expect(mun.registrationDeadline?.toISOString()).toBe(registrationDeadline.toISOString())
    expect(mun.accommodationProvided).toBe('PROVIDED')
  })

  it('committees table round-trips committeeType and portfoliosEnabled', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org5', email: `org5-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Committee Cols Mun', slug: `committee-cols-mun-${Date.now()}-${Math.random()}` })
      .returning()

    const [committee] = await db
      .insert(committees)
      .values({
        munId: mun.id,
        name: 'UNSC',
        committeeType: 'CRISIS',
        portfoliosEnabled: false,
      })
      .returning()

    expect(committee.committeeType).toBe('CRISIS')
    expect(committee.portfoliosEnabled).toBe(false)

    // Default applies when not explicitly set.
    const [defaultCommittee] = await db
      .insert(committees)
      .values({ munId: mun.id, name: 'UNHRC' })
      .returning()
    expect(defaultCommittee.portfoliosEnabled).toBe(true)
  })
})

describe('pipeline schema (Task 4: 7 net-new module tables)', () => {
  async function makeMun(label: string) {
    const [organizer] = await db
      .insert(users)
      .values({
        name: `Org ${label}`,
        email: `org-${label}-${Date.now()}-${Math.random()}@test.com`,
        role: 'ORGANIZER',
      })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: `Mun ${label}`,
        slug: `mun-${label}-${Date.now()}-${Math.random()}`,
      })
      .returning()
    return mun
  }

  it('mun_media inserts and reads back a round trip', async () => {
    const mun = await makeMun('media')

    const [row] = await db
      .insert(munMedia)
      .values({
        munId: mun.id,
        kind: 'LOGO',
        url: 'https://cdn.example.com/logo.png',
        storageKey: 'muns/logo.png',
        contentType: 'image/png',
        sizeBytes: 1024,
        displayOrder: 1,
      })
      .returning()

    expect(row.munId).toBe(mun.id)
    expect(row.kind).toBe('LOGO')
    expect(row.url).toBe('https://cdn.example.com/logo.png')
    expect(row.storageKey).toBe('muns/logo.png')
    expect(row.contentType).toBe('image/png')
    expect(row.sizeBytes).toBe(1024)
    expect(row.displayOrder).toBe(1)
    expect(row.createdAt).toBeInstanceOf(Date)

    const [fetched] = await db.select().from(munMedia).where(eq(munMedia.id, row.id))
    expect(fetched.kind).toBe('LOGO')
  })

  it('mun_executive_board inserts and reads back a round trip, including nullable committeeId', async () => {
    const mun = await makeMun('eb')
    const [committee] = await db
      .insert(committees)
      .values({ munId: mun.id, name: 'UNSC' })
      .returning()

    const [secGen] = await db
      .insert(munExecutiveBoard)
      .values({
        munId: mun.id,
        committeeId: null,
        name: 'Jane Doe',
        role: 'CUSTOM',
        customRole: 'Secretary-General',
        displayOrder: 0,
      })
      .returning()

    expect(secGen.committeeId).toBeNull()
    expect(secGen.role).toBe('CUSTOM')
    expect(secGen.customRole).toBe('Secretary-General')

    const [chair] = await db
      .insert(munExecutiveBoard)
      .values({
        munId: mun.id,
        committeeId: committee.id,
        name: 'John Smith',
        role: 'CHAIR',
      })
      .returning()

    expect(chair.committeeId).toBe(committee.id)
    expect(chair.role).toBe('CHAIR')
    expect(chair.customRole).toBeNull()
  })

  it('mun_form_fields inserts, reads back, and round-trips conditional-logic columns', async () => {
    const mun = await makeMun('form')

    const [parentField] = await db
      .insert(munFormFields)
      .values({
        munId: mun.id,
        fieldKey: 'needs_accommodation',
        fieldType: 'CHECKBOX',
        label: 'Do you need accommodation?',
        required: true,
        displayOrder: 0,
      })
      .returning()

    const [dependentField] = await db
      .insert(munFormFields)
      .values({
        munId: mun.id,
        fieldKey: 'accommodation_dates',
        fieldType: 'DATE',
        label: 'Check-in date',
        required: false,
        choices: null,
        displayOrder: 1,
        conditionalOn: parentField.fieldKey,
        conditionalOperator: 'EQUALS',
        conditionalValue: 'true',
      })
      .returning()

    expect(parentField.fieldKey).toBe('needs_accommodation')
    expect(dependentField.conditionalOn).toBe('needs_accommodation')
    expect(dependentField.conditionalOperator).toBe('EQUALS')
    expect(dependentField.conditionalValue).toBe('true')
  })

  it('mun_form_fields rejects a second row with the same (munId, fieldKey)', async () => {
    const mun = await makeMun('form-uq')

    await db.insert(munFormFields).values({
      munId: mun.id,
      fieldKey: 'institution',
      fieldType: 'INSTITUTION',
      label: 'Institution',
      required: true,
    })

    await expect(
      db.insert(munFormFields).values({
        munId: mun.id,
        fieldKey: 'institution',
        fieldType: 'SHORT_TEXT',
        label: 'Institution (dup)',
        required: false,
      }),
    ).rejects.toThrow()
  })

  it('mun_payment_settings inserts and reads back a round trip without leaking ciphertext by default', async () => {
    const mun = await makeMun('payment')

    const [row] = await db
      .insert(munPaymentSettings)
      .values({
        munId: mun.id,
        legalName: 'Example MUN Society',
        orgType: 'NON_PROFIT',
        addressLine1: '221B Baker Street',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500032',
        panLast4: '1234',
        panCiphertext: 'ciphertext-not-real-pan-value',
        authorizedRepName: 'A. Rep',
        authorizedRepEmail: 'rep@example.com',
        accountHolderName: 'Example MUN Society',
        bankName: 'Example Bank',
        accountNumberLast4: '6789',
        accountNumberCiphertext: 'ciphertext-not-real-account-value',
        ifsc: 'EXAM0001234',
        accountType: 'CURRENT',
        gateway: 'razorpay',
      })
      .returning()

    expect(row.munId).toBe(mun.id)
    expect(row.panLast4).toBe('1234')
    expect(row.accountNumberLast4).toBe('6789')
    expect(row.verificationState).toBe('NOT_SUBMITTED')

    // Masked read path shape: selecting explicit columns (as the real action
    // must — see the write-only comment above the table definition) never
    // touches the ciphertext columns.
    const [masked] = await db
      .select({
        id: munPaymentSettings.id,
        munId: munPaymentSettings.munId,
        panLast4: munPaymentSettings.panLast4,
        accountNumberLast4: munPaymentSettings.accountNumberLast4,
        verificationState: munPaymentSettings.verificationState,
      })
      .from(munPaymentSettings)
      .where(eq(munPaymentSettings.id, row.id))

    expect(masked.panLast4).toBe('1234')
    expect((masked as Record<string, unknown>).panCiphertext).toBeUndefined()
  })

  it('mun_payment_settings rejects a second row for the same munId (unique constraint)', async () => {
    const mun = await makeMun('payment-uq')

    const values = {
      munId: mun.id,
      legalName: 'Example MUN Society',
      orgType: 'NON_PROFIT',
      addressLine1: '221B Baker Street',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500032',
      panLast4: '1234',
      panCiphertext: 'ciphertext-not-real-pan-value',
      authorizedRepName: 'A. Rep',
      authorizedRepEmail: 'rep@example.com',
      accountHolderName: 'Example MUN Society',
      bankName: 'Example Bank',
      accountNumberLast4: '6789',
      accountNumberCiphertext: 'ciphertext-not-real-account-value',
      ifsc: 'EXAM0001234',
      accountType: 'CURRENT',
      gateway: 'razorpay',
    }

    await db.insert(munPaymentSettings).values(values)

    await expect(db.insert(munPaymentSettings).values(values)).rejects.toThrow()
  })

  it('mun_documents inserts and reads back a round trip', async () => {
    const mun = await makeMun('docs')

    const [row] = await db
      .insert(munDocuments)
      .values({
        munId: mun.id,
        kind: 'RULES',
        title: 'Rules of Procedure',
        url: 'https://cdn.example.com/rules.pdf',
        storageKey: 'muns/rules.pdf',
        contentType: 'application/pdf',
        sizeBytes: 204800,
      })
      .returning()

    expect(row.munId).toBe(mun.id)
    expect(row.kind).toBe('RULES')
    expect(row.title).toBe('Rules of Procedure')
    expect(row.contentType).toBe('application/pdf')
    expect(row.sizeBytes).toBe(204800)
  })

  it('mun_schedule_items inserts and reads back a round trip, including nullable committeeId', async () => {
    const mun = await makeMun('schedule')
    const startsAt = new Date('2027-03-01T09:00:00Z')
    const endsAt = new Date('2027-03-01T10:00:00Z')

    const [row] = await db
      .insert(munScheduleItems)
      .values({
        munId: mun.id,
        committeeId: null,
        title: 'Opening Ceremony',
        kind: 'OPENING_CEREMONY',
        startsAt,
        endsAt,
        location: 'Main Auditorium',
        displayOrder: 0,
      })
      .returning()

    expect(row.munId).toBe(mun.id)
    expect(row.committeeId).toBeNull()
    expect(row.kind).toBe('OPENING_CEREMONY')
    expect(row.startsAt.toISOString()).toBe(startsAt.toISOString())
    expect(row.endsAt.toISOString()).toBe(endsAt.toISOString())
    expect(row.location).toBe('Main Auditorium')
  })

  it('mun_contacts inserts and reads back a round trip', async () => {
    const mun = await makeMun('contact')

    const [row] = await db
      .insert(munContacts)
      .values({
        munId: mun.id,
        officialEmail: 'contact@examplemun.org',
        phone: '+91-9000000000',
        website: 'https://examplemun.org',
        socialLinks: { instagram: 'https://instagram.com/examplemun' },
        contactPersonName: 'Priya Rao',
        contactPersonRole: 'Secretary-General',
        contactPersonEmail: 'priya@examplemun.org',
        contactPersonPhone: '+91-9111111111',
      })
      .returning()

    expect(row.munId).toBe(mun.id)
    expect(row.officialEmail).toBe('contact@examplemun.org')
    expect(row.socialLinks).toEqual({ instagram: 'https://instagram.com/examplemun' })
    expect(row.contactPersonName).toBe('Priya Rao')
  })

  it('mun_contacts rejects a second row for the same munId (unique constraint)', async () => {
    const mun = await makeMun('contact-uq')

    await db.insert(munContacts).values({
      munId: mun.id,
      officialEmail: 'contact@examplemun.org',
      contactPersonName: 'Priya Rao',
      contactPersonEmail: 'priya@examplemun.org',
    })

    await expect(
      db.insert(munContacts).values({
        munId: mun.id,
        officialEmail: 'other@examplemun.org',
        contactPersonName: 'Other Person',
        contactPersonEmail: 'other@examplemun.org',
      }),
    ).rejects.toThrow()
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
