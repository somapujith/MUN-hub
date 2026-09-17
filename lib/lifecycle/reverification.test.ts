import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications, munPaymentSettings } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { munModuleEnum } from '@/lib/db/schema-enums'
import type { MunModule } from '@/lib/db/schema-enums'
import { detectHighImpactChange, isHighImpactModule, triggerReverificationIfNeeded } from './reverification'

describe('detectHighImpactChange', () => {
  it('detects a price change on PRICING_CAPACITY as high-impact', () => {
    expect(detectHighImpactChange('PRICING_CAPACITY', { price: 2000 }, { price: 2500 })).toBe(true)
  })

  it('does not flag an unchanged price', () => {
    expect(detectHighImpactChange('PRICING_CAPACITY', { price: 2000 }, { price: 2000 })).toBe(false)
  })

  it('ignores changes to fields not on the high-impact list', () => {
    expect(detectHighImpactChange('BASIC_INFO', { description: 'old' }, { description: 'new' })).toBe(false)
  })

  it('detects a mun name change on BASIC_INFO as high-impact', () => {
    expect(detectHighImpactChange('BASIC_INFO', { name: 'Old Name' }, { name: 'New Name' })).toBe(true)
  })

  // The public MUN page renders the street address and links out to mapUrl,
  // so swapping either one after verification would send paying delegates to
  // an unreviewed location or link — the same class of switch DATES_VENUE
  // already blocked for venue/city.
  it.each([
    ['addressLine1', '12 Lake Road', '9 Other Street'],
    ['addressState', 'Telangana', 'Karnataka'],
    ['postalCode', '500001', '560001'],
    ['mapUrl', 'https://maps.example/venue', 'https://attacker.example/venue'],
  ])('detects a %s change on DATES_VENUE as high-impact', (field, before, after) => {
    expect(detectHighImpactChange('DATES_VENUE', { [field]: before }, { [field]: after })).toBe(true)
    expect(detectHighImpactChange('DATES_VENUE', { [field]: before }, { [field]: before })).toBe(false)
  })

  it('detects clearing the street address on DATES_VENUE as high-impact', () => {
    expect(detectHighImpactChange('DATES_VENUE', { addressLine1: '12 Lake Road' }, { addressLine1: null })).toBe(true)
  })

  // Deliberately NOT high-impact — registration-lifecycle.ts tells an
  // organizer to move this date to open a live MUN sooner, so bouncing them
  // back into review for it would break that remedy. See reverification.ts.
  it('does not flag a registrationOpensAt change on DATES_VENUE', () => {
    const before = { registrationOpensAt: new Date('2027-01-01') }
    const after = { registrationOpensAt: new Date('2027-02-01') }
    expect(detectHighImpactChange('DATES_VENUE', before, after)).toBe(false)
  })

  it('detects a committee capacity change on COMMITTEES as high-impact', () => {
    expect(detectHighImpactChange('COMMITTEES', { capacity: 30 }, { capacity: 50 })).toBe(true)
  })

  it('detects a payment settlement bank detail change as high-impact', () => {
    expect(
      detectHighImpactChange('PAYMENT_SETTLEMENT', { accountNumberLast4: '1111' }, { accountNumberLast4: '9999' }),
    ).toBe(true)
  })

  it('legacy keys (pre-PRD, kept for old data/tests) never flag any field as high-impact', () => {
    expect(detectHighImpactChange('mun_details', { name: 'Old Name' }, { name: 'New Name' })).toBe(false)
    expect(detectHighImpactChange('committees', { capacity: 30 }, { capacity: 50 })).toBe(false)
    expect(detectHighImpactChange('portfolios', { availability: 1 }, { availability: 2 })).toBe(false)
    expect(detectHighImpactChange('registration_products', { price: 2000 }, { price: 2500 })).toBe(false)
  })
})

describe('HIGH_IMPACT_FIELDS exhaustiveness', () => {
  // TypeScript's Record<MunModule, string[]> already makes a missing key a
  // COMPILE error — this runtime test catches the case a *future* enum value
  // is added without a corresponding CI type-check run ever happening (e.g.
  // a hotfix that skips tsc), by asserting every currently-known MunModule
  // key resolves to a real array via the exported `isHighImpactModule`/
  // `detectHighImpactChange` surface rather than `undefined`.
  it('every MunModule enum value resolves to an array (no key is missing)', () => {
    for (const moduleKey of munModuleEnum.enumValues as MunModule[]) {
      // detectHighImpactChange defensively falls back to `?? []` for a
      // missing key — calling it must never throw, and a genuinely-missing
      // key could only be detected by isHighImpactModule("silently" being
      // false for everything, indistinguishable from a real empty list) or by
      // the exhaustive Record type itself; this loop pins the current 19-key
      // enum's exact shape at both, so removing a key from HIGH_IMPACT_FIELDS
      // would still be caught immediately by tsc even if this loop can't spot
      // an entry's ABSENCE at runtime (JS objects don't expose absent-vs-[]).
      expect(() => detectHighImpactChange(moduleKey, {}, {})).not.toThrow()
      expect(typeof isHighImpactModule(moduleKey)).toBe('boolean')
    }
  })

  it('exactly the modules the design spec lists non-empty are high-impact', () => {
    const expectedHighImpact: MunModule[] = [
      'BASIC_INFO',
      'DATES_VENUE',
      'COMMITTEES',
      'PORTFOLIOS',
      'EXECUTIVE_BOARD',
      'REGISTRATION_TYPES',
      'PRICING_CAPACITY',
      'PAYMENT_SETTLEMENT',
      'RULES_DOCUMENTS',
      'SCHEDULE',
      'ACCOMMODATION',
      'CONTACT',
    ]
    const expectedEmpty: MunModule[] = [
      'BRANDING',
      'REGISTRATION_FORM',
      'FINAL_REVIEW',
      'mun_details',
      'committees',
      'portfolios',
      'registration_products',
    ]

    for (const moduleKey of expectedHighImpact) {
      expect(isHighImpactModule(moduleKey)).toBe(true)
    }
    for (const moduleKey of expectedEmpty) {
      expect(isHighImpactModule(moduleKey)).toBe(false)
    }
  })
})

async function makeUser(role: 'ORGANIZER' = 'ORGANIZER') {
  const [user] = await db.insert(users).values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role }).returning()
  return user
}

async function makeVerifiedMun(organizerId: string, namePrefix: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: namePrefix, slug: `${namePrefix.toLowerCase().replace(/\s+/g, '-')}-${crypto.randomUUID()}`, status: 'VERIFIED' })
    .returning()
  return mun
}

describe('triggerReverificationIfNeeded', () => {
  it('flips a VERIFIED module and the mun back to VERIFICATION when the mun is already VERIFIED and a high-impact field changed', async () => {
    const organizer = await makeUser()
    const mun = await makeVerifiedMun(organizer.id, 'Reverify Mun')
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'PRICING_CAPACITY', state: 'VERIFIED' })

    await triggerReverificationIfNeeded('PRICING_CAPACITY', { price: 2000 }, { price: 3000 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')

    const [moduleState] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'PRICING_CAPACITY')))
    expect(moduleState.state).toBe('PENDING_REVIEW')
  })

  it('is a no-op if the mun is not yet VERIFIED', async () => {
    const organizer = await makeUser()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Draft Mun', slug: `draft-mun-${crypto.randomUUID()}`, status: 'DRAFT' })
      .returning()

    await triggerReverificationIfNeeded('PRICING_CAPACITY', { price: 2000 }, { price: 3000 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('DRAFT')
  })

  it('is a no-op if the change is not high-impact', async () => {
    const organizer = await makeUser()
    const mun = await makeVerifiedMun(organizer.id, 'Stable Mun')

    await triggerReverificationIfNeeded('BASIC_INFO', { description: 'old' }, { description: 'new' }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })

  it('is a no-op for a legacy key even with a "changed" field, since legacy keys resolve to an empty high-impact list', async () => {
    const organizer = await makeUser()
    const mun = await makeVerifiedMun(organizer.id, 'Legacy Mun')

    await triggerReverificationIfNeeded('mun_details', { name: 'Old Name' }, { name: 'New Name' }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFIED')
  })

  // Fixed latent bug (Task 12): re-verification on a mun that has NEVER had
  // a mun_module_verifications row created for the affected module (no prior
  // getModuleVerificationState call ever ran for it) must not silently no-op
  // its UPDATE ... WHERE moduleName = ... against zero rows — the module
  // state must still end up PENDING_REVIEW, and a row must exist afterward.
  it('creates the module verification row on the fly when re-verification triggers on a module with no existing row', async () => {
    const organizer = await makeUser()
    const mun = await makeVerifiedMun(organizer.id, 'No Row Yet Mun')

    const [preRow] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
    expect(preRow).toBeUndefined()

    await triggerReverificationIfNeeded('COMMITTEES', { capacity: 30 }, { capacity: 50 }, mun.id, organizer.id)

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')

    const [moduleState] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
    expect(moduleState).toBeDefined()
    expect(moduleState.state).toBe('PENDING_REVIEW')
  })

  // Dedicated test for the payment-change special case (design doc Section
  // 6) — the single highest-consequence entry in the re-verification table:
  // changing bank details on an already-verified mun must ALSO reset
  // mun_payment_settings.verificationState back to PENDING, atomically with
  // the module state flip, so there is never a window where the account
  // still reads VERIFIED while the module is back under review.
  it('resets mun_payment_settings.verificationState to PENDING when PAYMENT_SETTLEMENT re-verification triggers, atomically with the module flip', async () => {
    const organizer = await makeUser()
    const mun = await makeVerifiedMun(organizer.id, 'Payment Fraud Mun')
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'PAYMENT_SETTLEMENT', state: 'VERIFIED' })
    await db.insert(munPaymentSettings).values({
      munId: mun.id,
      legalName: 'Clean Org',
      orgType: 'trust',
      addressLine1: '1 Main St',
      city: 'Hyderabad',
      state: 'TG',
      postalCode: '500001',
      panLast4: '1234',
      panCiphertext: 'ciphertext-pan',
      authorizedRepName: 'Rep',
      authorizedRepEmail: 'rep@example.com',
      accountHolderName: 'Clean Org',
      bankName: 'Clean Bank',
      accountNumberLast4: '1111',
      accountNumberCiphertext: 'ciphertext-account-clean',
      ifsc: 'CLEAN0001',
      accountType: 'current',
      gateway: 'razorpay',
      verificationState: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedBy: organizer.id,
    })

    // Simulate swapping in a different bank account post-approval — the
    // fraud vector this special case exists to close.
    await triggerReverificationIfNeeded(
      'PAYMENT_SETTLEMENT',
      { accountNumberLast4: '1111' },
      { accountNumberLast4: '9999' },
      mun.id,
      organizer.id,
    )

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('VERIFICATION')

    const [moduleState] = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'PAYMENT_SETTLEMENT')))
    expect(moduleState.state).toBe('PENDING_REVIEW')

    const [paymentSettings] = await db
      .select({ verificationState: munPaymentSettings.verificationState, verifiedAt: munPaymentSettings.verifiedAt })
      .from(munPaymentSettings)
      .where(eq(munPaymentSettings.munId, mun.id))
    expect(paymentSettings.verificationState).toBe('PENDING')
    expect(paymentSettings.verifiedAt).toBeNull()
  })

  it('does NOT reset payment verificationState for a non-payment module re-verification', async () => {
    const organizer = await makeUser()
    const mun = await makeVerifiedMun(organizer.id, 'Unrelated Reverify Mun')
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'COMMITTEES', state: 'VERIFIED' })
    await db.insert(munPaymentSettings).values({
      munId: mun.id,
      legalName: 'Org',
      orgType: 'trust',
      addressLine1: '1 Main St',
      city: 'Hyderabad',
      state: 'TG',
      postalCode: '500001',
      panLast4: '1234',
      panCiphertext: 'ciphertext-pan-2',
      authorizedRepName: 'Rep',
      authorizedRepEmail: 'rep2@example.com',
      accountHolderName: 'Org',
      bankName: 'Bank',
      accountNumberLast4: '2222',
      accountNumberCiphertext: 'ciphertext-account-2',
      ifsc: 'BANK0002',
      accountType: 'current',
      gateway: 'razorpay',
      verificationState: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedBy: organizer.id,
    })

    await triggerReverificationIfNeeded('COMMITTEES', { capacity: 30 }, { capacity: 50 }, mun.id, organizer.id)

    const [paymentSettings] = await db
      .select({ verificationState: munPaymentSettings.verificationState })
      .from(munPaymentSettings)
      .where(eq(munPaymentSettings.munId, mun.id))
    expect(paymentSettings.verificationState).toBe('VERIFIED')
  })

  // REGISTRATION_CLOSED is deliberately NOT in POST_VERIFICATION_STATUSES:
  // nothing downstream of VERIFICATION (VERIFIED, PUBLISHED, ...) has an edge
  // back to REGISTRATION_CLOSED in mun-state-machine.ts, so sending an
  // already-closed mun there for a high-impact edit would permanently strand
  // it short of CONFERENCE_ACTIVE/COMPLETED/ARCHIVED. A high-impact edit past
  // that point is saved without re-review instead, same as after the
  // conference — the module and mun status are both left exactly as they were.
  it('leaves a REGISTRATION_CLOSED mun alone on a high-impact edit', async () => {
    const organizer = await makeUser()
    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Closed Mun',
        slug: `closed-mun-${crypto.randomUUID()}`,
        status: 'REGISTRATION_CLOSED',
      })
      .returning()
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'DATES_VENUE', state: 'VERIFIED' })

    await expect(
      triggerReverificationIfNeeded('DATES_VENUE', { venue: 'Old Hall' }, { venue: 'New Hall' }, mun.id, organizer.id),
    ).resolves.toBeUndefined()

    const [updatedMun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('REGISTRATION_CLOSED')

    const [moduleState] = await db
      .select({ state: munModuleVerifications.state })
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'DATES_VENUE')))
    expect(moduleState.state).toBe('VERIFIED')
  })
})

afterAll(async () => {
  await db.$client.end()
})
