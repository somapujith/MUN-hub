import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munModuleVerifications, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertModuleNotLocked, recomputeMunProgress } from './module-completion'
import { createCommittee, createPortfolio, createRegistrationProduct, updateMunDetails } from '@/lib/actions/mun-config'
import { createEbMember } from '@/lib/actions/executive-board'
import { uploadMunDocument } from '@/lib/actions/mun-documents'
import { createScheduleItem } from '@/lib/actions/mun-schedule'
import { upsertMunContact } from '@/lib/actions/mun-contact'
import { upsertPaymentSettings } from '@/lib/actions/payment-settlement'
import { uploadMunMedia } from '@/lib/actions/mun-branding'
import { SAMPLE_FILES } from '@/lib/storage/in-memory-bindings'
import { createAccommodationOption } from '@/lib/actions/accommodation'

// -----------------------------------------------------------------------------
// Task 12 Step 4 — LOCKED enforcement across all 9 wired action files.
//
// Rule under test: while a mun is in one of the "under active review"
// statuses (CONTENT_SUBMITTED, AUTOMATED_VALIDATION, ORGANIZER_CONFIRMATION,
// VERIFICATION), an ORGANIZER edit to a high-impact module (non-empty
// HIGH_IMPACT_FIELDS) must be rejected, but an ADMIN edit to the same module
// during the same window must still succeed, and an organizer edit to a
// module with an EMPTY HIGH_IMPACT_FIELDS list (BRANDING) must also still
// succeed even under active review.
//
// Note on OPERATIONS: `assertModuleNotLocked` itself does carve out
// OPERATIONS alongside ADMIN/SUPER_ADMIN (see the unit-level describe block
// below, which exercises that directly). But every action file in this repo
// gates its module mutations on `assertOwnsOrAdmin` FIRST (see
// lib/auth/ownership.ts), which only allows ADMIN/SUPER_ADMIN or the owning
// organizer — OPERATIONS is not in that list. So in practice, through the
// wired action files, an OPERATIONS-role caller is rejected by
// `assertOwnsOrAdmin` before ever reaching `assertModuleNotLocked`, even
// though the locking rule alone would have allowed it. This is a pre-
// existing scope boundary in `assertOwnsOrAdmin`, not something this task
// introduced or is scoped to fix — the wired-action-file tests below
// therefore use ADMIN (not OPERATIONS) for the "privileged edit succeeds"
// case, matching what the system actually allows end to end today.
//
// ACCOMMODATION (accommodation.ts) added post-review (2026-09-15): this
// module was missed in the original Step 4 pass despite having a non-empty
// HIGH_IMPACT_FIELDS list (['price','capacity','name','status']) and already
// being surfaced as LOCKED on the organizer dashboard via
// recomputeMunProgress/isModuleLockedForStatus — a real gap where the
// dashboard claimed a lock the backend didn't enforce. Fixed in
// accommodation.ts; test added here alongside the other 8.
// -----------------------------------------------------------------------------

async function makeUser(role: 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' | 'OPERATIONS' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: (typeof muns.$inferInsert)['status'] = 'VERIFICATION') {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Locked Mun', slug: `locked-mun-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

const REVIEW_STATUSES = ['CONTENT_SUBMITTED', 'AUTOMATED_VALIDATION', 'ORGANIZER_CONFIRMATION', 'VERIFICATION'] as const

describe('assertModuleNotLocked (unit)', () => {
  it.each(REVIEW_STATUSES)('rejects an organizer edit to a high-impact module while mun is %s', async (status) => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, status)

    await expect(assertModuleNotLocked(mun.id, 'COMMITTEES', sessionFor(organizer))).rejects.toThrow(/locked/i)
  })

  it.each(['ADMIN', 'SUPER_ADMIN', 'OPERATIONS'] as const)(
    'allows a %s edit to a high-impact module during VERIFICATION',
    async (role) => {
      const organizer = await makeUser('ORGANIZER')
      const reviewer = await makeUser(role)
      const mun = await makeMun(organizer.id, 'VERIFICATION')

      await expect(assertModuleNotLocked(mun.id, 'COMMITTEES', sessionFor(reviewer))).resolves.toBeUndefined()
    },
  )

  it('allows an organizer edit to a high-impact module when the mun is NOT under active review (e.g. ONBOARDING)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'ONBOARDING')

    await expect(assertModuleNotLocked(mun.id, 'COMMITTEES', sessionFor(organizer))).resolves.toBeUndefined()
  })

  it('allows an organizer edit to a module with an EMPTY HIGH_IMPACT_FIELDS list (BRANDING) even under active review', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await expect(assertModuleNotLocked(mun.id, 'BRANDING', sessionFor(organizer))).resolves.toBeUndefined()
  })

  it('rejects an unauthenticated (null session) caller with Forbidden', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await expect(assertModuleNotLocked(mun.id, 'COMMITTEES', null)).rejects.toThrow('Forbidden')
  })

  it('unlocks only the module a reviewer sent back, and shows the rest as LOCKED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    await db.insert(munModuleVerifications).values([
      { munId: mun.id, moduleName: 'COMMITTEES', state: 'CHANGES_REQUESTED' },
      { munId: mun.id, moduleName: 'CONTACT', state: 'PENDING_REVIEW' },
    ])

    await expect(assertModuleNotLocked(mun.id, 'COMMITTEES', sessionFor(organizer))).resolves.toBeUndefined()
    await expect(assertModuleNotLocked(mun.id, 'CONTACT', sessionFor(organizer))).rejects.toThrow(/locked/i)

    const progress = await recomputeMunProgress(mun.id)
    const statusOf = (key: string) => progress.modules.find((m) => m.key === key)?.completionStatus
    expect(statusOf('COMMITTEES')).not.toBe('LOCKED')
    expect(statusOf('CONTACT')).toBe('LOCKED')
  })
})

describe('LOCKED enforcement wired into action files', () => {
  it('mun-config.ts updateMunDetails: rejects organizer, allows admin, during VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await expect(updateMunDetails(mun.id, { name: 'New Name' }, sessionFor(organizer))).rejects.toThrow(/locked/i)
    await expect(updateMunDetails(mun.id, { name: 'Admin Name' }, sessionFor(admin))).resolves.toMatchObject({
      name: 'Admin Name',
    })
  })

  it('mun-config.ts updateMunDetails: a sent-back Dates & Venue is editable while Basic Info stays locked', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'DATES_VENUE', state: 'CHANGES_REQUESTED' })
    const session = sessionFor(organizer)

    // The setup form sends unchanged Basic Info fields along with the fix.
    await expect(
      updateMunDetails(mun.id, { name: mun.name, venue: 'Fixed Venue Hall' }, session),
    ).resolves.toMatchObject({ venue: 'Fixed Venue Hall' })
    await expect(updateMunDetails(mun.id, { name: 'Sneaky Rename' }, session)).rejects.toThrow(/"BASIC_INFO" module is locked/)
  })

  it('mun-config.ts createCommittee: rejects organizer, allows admin, during CONTENT_SUBMITTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'CONTENT_SUBMITTED')

    await expect(
      createCommittee({ munId: mun.id, name: 'UNSC', capacity: 20 }, sessionFor(organizer)),
    ).rejects.toThrow(/locked/i)

    await expect(
      createCommittee({ munId: mun.id, name: 'UNSC', capacity: 20 }, sessionFor(admin)),
    ).resolves.toMatchObject({ name: 'UNSC' })
  })

  it('mun-config.ts createPortfolio: rejects organizer during VERIFICATION (via committee -> mun ownership walk)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    // Create the committee BEFORE locking the mun (createCommittee itself
    // would be rejected once the mun is under review).
    const onboardingMun = await makeMun(organizer.id, 'ONBOARDING')
    const committee = await createCommittee({ munId: onboardingMun.id, name: 'UNHRC', capacity: 20 }, sessionFor(organizer))

    await db.update(muns).set({ status: 'VERIFICATION' }).where(eq(muns.id, onboardingMun.id))

    await expect(
      createPortfolio({ committeeId: committee.id, name: 'France' }, sessionFor(organizer)),
    ).rejects.toThrow(/locked/i)

    await expect(
      createPortfolio({ committeeId: committee.id, name: 'France' }, sessionFor(admin)),
    ).resolves.toMatchObject({ name: 'France' })
  })

  it('mun-config.ts createRegistrationProduct: rejects organizer during VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await expect(
      createRegistrationProduct({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 50 }, sessionFor(organizer)),
    ).rejects.toThrow(/locked/i)

    await expect(
      createRegistrationProduct({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 50 }, sessionFor(admin)),
    ).resolves.toMatchObject({ name: 'Delegate' })
  })

  it('executive-board.ts createEbMember: rejects organizer, allows admin, during ORGANIZER_CONFIRMATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'ORGANIZER_CONFIRMATION')

    await expect(
      createEbMember({ munId: mun.id, name: 'Chair Person', role: 'CHAIR' }, sessionFor(organizer)),
    ).rejects.toThrow(/locked/i)

    await expect(
      createEbMember({ munId: mun.id, name: 'Chair Person', role: 'CHAIR' }, sessionFor(admin)),
    ).resolves.toMatchObject({ name: 'Chair Person' })
  })

  it('mun-documents.ts uploadMunDocument: rejects organizer, allows admin, during AUTOMATED_VALIDATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'AUTOMATED_VALIDATION')
    const file = Buffer.from('%PDF-1.4 fake pdf content')

    await expect(
      uploadMunDocument(
        { munId: mun.id, kind: 'RULES', title: 'Rules', file, contentType: 'application/pdf' },
        sessionFor(organizer),
      ),
    ).rejects.toThrow(/locked/i)

    await expect(
      uploadMunDocument(
        { munId: mun.id, kind: 'RULES', title: 'Rules', file, contentType: 'application/pdf' },
        sessionFor(admin),
      ),
    ).resolves.toMatchObject({ title: 'Rules' })
  })

  it('mun-schedule.ts createScheduleItem: rejects organizer, allows admin, during VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const startsAt = new Date('2027-01-01T09:00:00Z')
    const endsAt = new Date('2027-01-01T10:00:00Z')

    await expect(
      createScheduleItem(
        { munId: mun.id, title: 'Opening', kind: 'OPENING_CEREMONY', startsAt, endsAt },
        sessionFor(organizer),
      ),
    ).rejects.toThrow(/locked/i)

    await expect(
      createScheduleItem(
        { munId: mun.id, title: 'Opening', kind: 'OPENING_CEREMONY', startsAt, endsAt },
        sessionFor(admin),
      ),
    ).resolves.toMatchObject({ title: 'Opening' })
  })

  it('mun-contact.ts upsertMunContact: rejects organizer, allows admin, during CONTENT_SUBMITTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'CONTENT_SUBMITTED')
    const input = {
      officialEmail: 'contact@example.com',
      contactPersonName: 'Contact Person',
      contactPersonEmail: 'person@example.com',
    }

    await expect(upsertMunContact(mun.id, input, sessionFor(organizer))).rejects.toThrow(/locked/i)
    await expect(upsertMunContact(mun.id, input, sessionFor(admin))).resolves.toMatchObject({
      officialEmail: 'contact@example.com',
    })
  })

  it('payment-settlement.ts upsertPaymentSettings: rejects organizer, allows admin, during VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const input = {
      legalName: 'Org Legal Name',
      orgType: 'trust',
      addressLine1: '1 Main St',
      city: 'Hyderabad',
      state: 'TG',
      postalCode: '500001',
      pan: 'ABCDE1234F',
      authorizedRepName: 'Rep',
      authorizedRepEmail: 'rep@example.com',
      accountHolderName: 'Org',
      bankName: 'Bank',
      accountNumber: '1234567890',
      ifsc: 'BANK0001234',
      accountType: 'current',
      gateway: 'razorpay',
    }

    await expect(upsertPaymentSettings(mun.id, input, sessionFor(organizer))).rejects.toThrow(/locked/i)
    await expect(upsertPaymentSettings(mun.id, input, sessionFor(admin))).resolves.toMatchObject({
      legalName: 'Org Legal Name',
    })
  })

  it('accommodation.ts createAccommodationOption: rejects organizer, allows admin, during VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await expect(
      createAccommodationOption({ munId: mun.id, name: 'Standard Room', price: 2000, capacity: 40 }, sessionFor(organizer)),
    ).rejects.toThrow(/locked/i)

    await expect(
      createAccommodationOption({ munId: mun.id, name: 'Standard Room', price: 2000, capacity: 40 }, sessionFor(admin)),
    ).resolves.toMatchObject({ name: 'Standard Room' })
  })

  it('mun-branding.ts uploadMunMedia: EMPTY HIGH_IMPACT_FIELDS module (BRANDING) stays editable for organizers even during VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const file = SAMPLE_FILES.png

    await expect(
      uploadMunMedia({ munId: mun.id, kind: 'LOGO', file, contentType: 'image/png' }, sessionFor(organizer)),
    ).resolves.toMatchObject({ kind: 'LOGO' })
  })
})

afterAll(async () => {
  await db.$client.end()
})
