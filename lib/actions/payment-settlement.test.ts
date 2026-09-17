import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  munModuleVerifications,
  munPaymentSettings,
  muns,
  payments,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import {
  getMunPaymentsSummary,
  getPaymentSettings,
  setPaymentVerificationState,
  upsertPaymentSettings,
} from './payment-settlement'
import type { UpsertPaymentSettingsInput } from './payment-settlement'

async function makeUser(role: 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Payment Mun', slug: `payment-mun-${crypto.randomUUID()}` })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

const FULL_PAN = 'ABCDE1234F'
const FULL_ACCOUNT_NUMBER = '000123456789012'

function fullInput(overrides: Partial<UpsertPaymentSettingsInput> = {}): UpsertPaymentSettingsInput {
  return {
    legalName: 'Example Conference Society',
    orgType: 'NON_PROFIT',
    addressLine1: '221B Baker Street',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    pan: FULL_PAN,
    authorizedRepName: 'Jane Organizer',
    authorizedRepEmail: 'jane@example.com',
    accountHolderName: 'Example Conference Society',
    bankName: 'Example Bank',
    accountNumber: FULL_ACCOUNT_NUMBER,
    ifsc: 'EXAM0001234',
    accountType: 'CURRENT',
    gateway: 'RAZORPAY',
    ...overrides,
  }
}

describe('payment-settlement actions', () => {
  describe('upsertPaymentSettings', () => {
    it('lets the owning organizer create settlement settings and returns a masked view', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const result = await upsertPaymentSettings(mun.id, fullInput(), session)

      expect(result.munId).toBe(mun.id)
      expect(result.panLast4).toBe(FULL_PAN.slice(-4))
      expect(result.accountNumberLast4).toBe(FULL_ACCOUNT_NUMBER.slice(-4))
      expect(result.verificationState).toBe('NOT_SUBMITTED')
      // The masked type structurally has no ciphertext fields — going
      // through `unknown` proves this isn't a simple property-optional
      // check but a genuine structural absence.
      const asRecord = result as unknown as Record<string, unknown>
      expect(asRecord.panCiphertext).toBeUndefined()
      expect(asRecord.accountNumberCiphertext).toBeUndefined()
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(upsertPaymentSettings(mun.id, fullInput(), sessionFor(stranger))).rejects.toThrow('Forbidden')
    })

    it('allows an admin to upsert settings for any mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)

      const result = await upsertPaymentSettings(mun.id, fullInput(), sessionFor(admin))
      expect(result.munId).toBe(mun.id)
    })

    it('re-upserting replaces the single row for the mun (onConflictDoUpdate)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await upsertPaymentSettings(mun.id, fullInput({ bankName: 'First Bank' }), session)
      const second = await upsertPaymentSettings(mun.id, fullInput({ bankName: 'Second Bank', accountNumber: '999888777666555' }), session)

      expect(second.bankName).toBe('Second Bank')
      expect(second.accountNumberLast4).toBe('6555'.slice(-4))

      const fetched = await getPaymentSettings(mun.id, session)
      expect(fetched?.bankName).toBe('Second Bank')
    })
  })

  describe('getPaymentSettings — leak-proof', () => {
    it('returns null when no settings row exists yet', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const result = await getPaymentSettings(mun.id, session)
      expect(result).toBeNull()
    })

    it('rejects a non-owning, non-admin caller with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(owner))

      await expect(getPaymentSettings(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })

    it('allows OPERATIONS/ADMIN/SUPER_ADMIN to read masked settings', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('SUPER_ADMIN')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))

      const result = await getPaymentSettings(mun.id, sessionFor(admin))
      expect(result?.munId).toBe(mun.id)
    })

    /**
     * THE test that matters most in this file: serialize the returned object
     * and prove neither the full PAN nor the full account number appear
     * anywhere in it, and that no ciphertext field name leaked through
     * either — while separately confirming the last4 values ARE correct.
     * This is written to actually fail if someone later adds
     * panCiphertext/accountNumberCiphertext to the select in
     * getPaymentSettings, or accidentally includes the plaintext in a new
     * field.
     */
    it('never leaks the full PAN, full account number, or any ciphertext field through getPaymentSettings', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await upsertPaymentSettings(mun.id, fullInput(), session)
      const result = await getPaymentSettings(mun.id, session)
      expect(result).not.toBeNull()

      const serialized = JSON.stringify(result)

      // The full plaintext values must never appear in the serialized output.
      expect(serialized).not.toContain(FULL_PAN)
      expect(serialized).not.toContain(FULL_ACCOUNT_NUMBER)

      // No ciphertext-named field leaked through (proves the select's column
      // list didn't grow to include panCiphertext/accountNumberCiphertext).
      expect(serialized).not.toContain('Ciphertext')

      // The masked last4 values must still be correct and present.
      expect(result?.panLast4).toBe(FULL_PAN.slice(-4))
      expect(result?.accountNumberLast4).toBe(FULL_ACCOUNT_NUMBER.slice(-4))
      expect(serialized).toContain(FULL_PAN.slice(-4))
      expect(serialized).toContain(FULL_ACCOUNT_NUMBER.slice(-4))
    })
  })

  describe('re-verification after a verified account changes', () => {
    it('drops a VERIFIED account back to PENDING when the bank details change', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))
      await setPaymentVerificationState(mun.id, 'VERIFIED', sessionFor(admin))

      const swapped = await upsertPaymentSettings(
        mun.id,
        fullInput({ accountNumber: '999888777666555', ifsc: 'OTHR0009999', legalName: 'Someone Else' }),
        sessionFor(organizer),
      )

      expect(swapped.verificationState).toBe('PENDING')
      expect(swapped.verifiedAt).toBeNull()
      const [row] = await db
        .select({ verifiedBy: munPaymentSettings.verifiedBy })
        .from(munPaymentSettings)
        .where(eq(munPaymentSettings.munId, mun.id))
      expect(row.verifiedBy).toBeNull()
    })

    it('keeps VERIFIED when nothing that was verified changed', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))
      await setPaymentVerificationState(mun.id, 'VERIFIED', sessionFor(admin))

      const resaved = await upsertPaymentSettings(
        mun.id,
        fullInput({ settlementNotes: 'Call the treasurer first' }),
        sessionFor(organizer),
      )

      expect(resaved.verificationState).toBe('VERIFIED')
      expect(resaved.verifiedAt).not.toBeNull()
    })

    it('sends an already-published mun back to VERIFICATION and its module to PENDING_REVIEW', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))
      await setPaymentVerificationState(mun.id, 'VERIFIED', sessionFor(admin))
      await db.update(muns).set({ status: 'PUBLISHED' }).where(eq(muns.id, mun.id))
      await db
        .insert(munModuleVerifications)
        .values({ munId: mun.id, moduleName: 'PAYMENT_SETTLEMENT', state: 'VERIFIED' })
        .onConflictDoNothing()

      await upsertPaymentSettings(mun.id, fullInput({ accountNumber: '111222333444555' }), sessionFor(organizer))

      const [after] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
      expect(after.status).toBe('VERIFICATION')
      const [module] = await db
        .select({ state: munModuleVerifications.state })
        .from(munModuleVerifications)
        .where(
          and(
            eq(munModuleVerifications.munId, mun.id),
            eq(munModuleVerifications.moduleName, 'PAYMENT_SETTLEMENT'),
          ),
        )
      expect(module.state).toBe('PENDING_REVIEW')
    })
  })

  describe('setPaymentVerificationState', () => {
    it('allows ADMIN to transition verificationState and records an admin_actions row', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))

      const updated = await setPaymentVerificationState(mun.id, 'VERIFIED', sessionFor(admin))
      expect(updated.verificationState).toBe('VERIFIED')
      expect(updated.verifiedAt).not.toBeNull()
    })

    it('allows SUPER_ADMIN to transition verificationState', async () => {
      const organizer = await makeUser('ORGANIZER')
      const superAdmin = await makeUser('SUPER_ADMIN')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))

      const updated = await setPaymentVerificationState(mun.id, 'FAILED', sessionFor(superAdmin))
      expect(updated.verificationState).toBe('FAILED')
      expect(updated.verifiedAt).toBeNull()
    })

    it('rejects an OPERATIONS caller (stricter than the general review bar)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))

      const opsSession: Session = { userId: crypto.randomUUID(), role: 'OPERATIONS' }
      await expect(setPaymentVerificationState(mun.id, 'VERIFIED', opsSession)).rejects.toThrow('Forbidden')
    })

    it('rejects the owning organizer (admin-only action)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))

      await expect(setPaymentVerificationState(mun.id, 'VERIFIED', sessionFor(organizer))).rejects.toThrow('Forbidden')
    })

    it('throws when no settings row exists yet for the mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)

      await expect(setPaymentVerificationState(mun.id, 'VERIFIED', sessionFor(admin))).rejects.toThrow('not found')
    })
  })

  describe('refund policy', () => {
    it('no longer writes refundPolicy, and leaves an existing value untouched', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await upsertPaymentSettings(mun.id, fullInput(), sessionFor(organizer))
      await db
        .update(munPaymentSettings)
        .set({ refundPolicy: 'legacy text' })
        .where(eq(munPaymentSettings.munId, mun.id))

      const result = await upsertPaymentSettings(mun.id, fullInput({ bankName: 'Other Bank' }), sessionFor(organizer))
      expect(result).not.toHaveProperty('refundPolicy')

      const [row] = await db
        .select({ refundPolicy: munPaymentSettings.refundPolicy })
        .from(munPaymentSettings)
        .where(eq(munPaymentSettings.munId, mun.id))
      expect(row.refundPolicy).toBe('legacy text')
    })
  })

  describe('getMunPaymentsSummary', () => {
    async function paid(
      munId: string,
      productId: string,
      opts: {
        amount: number
        fee?: number | null
        tax?: number | null
        net?: number | null
        paymentStatus?: 'PAID' | 'PENDING' | 'FAILED'
        registrationStatus?: 'CONFIRMED' | 'ATTENDED' | 'CANCELLED' | 'PAYMENT_PENDING'
        provider?: string
      },
    ) {
      const delegate = await makeUser('STUDENT')
      const [registration] = await db
        .insert(registrations)
        .values({
          userId: delegate.id,
          munId,
          registrationProductId: productId,
          status: opts.registrationStatus ?? 'CONFIRMED',
        })
        .returning()
      await db.insert(payments).values({
        registrationId: registration.id,
        providerOrderId: `order-${crypto.randomUUID()}`,
        amount: opts.amount,
        platformFeeAmount: opts.fee ?? null,
        platformFeeTaxAmount: opts.tax ?? null,
        organizerNetAmount: opts.net ?? null,
        status: opts.paymentStatus ?? 'PAID',
        ...(opts.provider ? { provider: opts.provider } : {}),
      })
    }

    async function munWithProduct() {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const [product] = await db
        .insert(registrationProducts)
        .values({ munId: mun.id, name: 'Delegate', price: 1499, capacity: 100 })
        .returning()
      return { organizer, mun, product }
    }

    it('sums gross, fee, fee tax and net over paid registrations that still stand', async () => {
      const { organizer, mun, product } = await munWithProduct()
      await paid(mun.id, product.id, { amount: 1499, fee: 37, tax: 7, net: 1455 })
      await paid(mun.id, product.id, { amount: 1499, fee: 37, tax: 7, net: 1455, registrationStatus: 'ATTENDED' })
      // Legacy row with no split: counts as zero fee.
      await paid(mun.id, product.id, { amount: 1000 })
      // Not counted: late payment (money owed back), pending and failed payments.
      await paid(mun.id, product.id, { amount: 5000, fee: 0, tax: 0, net: 5000, registrationStatus: 'CANCELLED' })
      await paid(mun.id, product.id, { amount: 7000, paymentStatus: 'PENDING', registrationStatus: 'PAYMENT_PENDING' })
      await paid(mun.id, product.id, { amount: 9000, paymentStatus: 'FAILED', registrationStatus: 'CANCELLED' })

      expect(await getMunPaymentsSummary(mun.id, sessionFor(organizer))).toEqual([
        {
          currency: 'INR',
          grossCollected: 3998,
          platformFee: 74,
          platformFeeTax: 14,
          organizerNet: 3910,
          paidRegistrations: 3,
        },
      ])
    })

    it('leaves out mock checkout payments unless the mock adapter is active', async () => {
      const { organizer, mun, product } = await munWithProduct()
      await paid(mun.id, product.id, { amount: 1499, fee: 37, tax: 7, net: 1455 })
      await paid(mun.id, product.id, { amount: 2000, fee: 50, tax: 9, net: 1941, provider: 'razorpay' })

      vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'true')
      expect(await getMunPaymentsSummary(mun.id, sessionFor(organizer))).toEqual([
        expect.objectContaining({ grossCollected: 3499, organizerNet: 3396, paidRegistrations: 2 }),
      ])

      // Deployed with the mock switched off: the mock row moved no money.
      vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'false')
      expect(await getMunPaymentsSummary(mun.id, sessionFor(organizer))).toEqual([
        {
          currency: 'INR',
          grossCollected: 2000,
          platformFee: 50,
          platformFeeTax: 9,
          organizerNet: 1941,
          paidRegistrations: 1,
        },
      ])
    })

    it('is empty before anything is paid', async () => {
      const { organizer, mun } = await munWithProduct()
      expect(await getMunPaymentsSummary(mun.id, sessionFor(organizer))).toEqual([])
    })

    it('is owner-or-admin only', async () => {
      const { mun } = await munWithProduct()
      const stranger = await makeUser('ORGANIZER')
      const student = await makeUser('STUDENT')
      const admin = await makeUser('ADMIN')
      await expect(getMunPaymentsSummary(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
      await expect(getMunPaymentsSummary(mun.id, sessionFor(student))).rejects.toThrow('Forbidden')
      await expect(getMunPaymentsSummary(mun.id, null)).rejects.toThrow('Forbidden')
      await expect(getMunPaymentsSummary(mun.id, sessionFor(admin))).resolves.toEqual([])
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
