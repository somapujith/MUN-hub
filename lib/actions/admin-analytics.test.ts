import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { PaymentStatus } from '@/lib/db/schema-enums'
import { getAdminAnalytics } from './admin-analytics'

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

async function makeUser(role: AnyRole, extra: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `analytics ${role}`, email: `analytics-${crypto.randomUUID()}@test.dev`, role, ...extra })
    .returning()
  return user
}

function sess(user: { id: string; role: AnyRole }): Session {
  return { userId: user.id, role: user.role }
}

// The local DB is shared with other test runs, so money assertions use a
// currency code no other row has.
function uniqueCurrency(): string {
  return `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

async function addPayment(
  munId: string,
  productId: string,
  currency: string,
  status: PaymentStatus,
  amount: number,
  platformFeeAmount: number | null,
) {
  const delegate = await makeUser('STUDENT')
  const [registration] = await db
    .insert(registrations)
    .values({ userId: delegate.id, munId, registrationProductId: productId, status: 'CONFIRMED' })
    .returning()
  await db.insert(payments).values({
    registrationId: registration.id,
    providerOrderId: `order_${crypto.randomUUID()}`,
    amount,
    currency,
    status,
    platformFeeAmount,
  })
}

describe('getAdminAnalytics', () => {
  it('sums GMV and platform fees over PAID payments only, per currency', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Analytics Mun', slug: `analytics-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 50 })
      .returning()
    const currency = uniqueCurrency()

    await addPayment(mun.id, product.id, currency, 'PAID', 1000, 50)
    await addPayment(mun.id, product.id, currency, 'PAID', 2500, 125)
    // An old row from before the fee breakdown existed.
    await addPayment(mun.id, product.id, currency, 'PAID', 700, null)
    await addPayment(mun.id, product.id, currency, 'FAILED', 9999, 500)
    await addPayment(mun.id, product.id, currency, 'PENDING', 8888, 400)

    const analytics = await getAdminAnalytics(sess(ops))

    expect(analytics.revenue.find((row) => row.currency === currency)).toEqual({
      currency,
      gmv: 4200,
      platformFeeTotal: 175,
      paidPayments: 3,
      paidPaymentsWithoutFeeBreakdown: 1,
    })
    expect(analytics.registrationsByStatus.CONFIRMED).toBeGreaterThanOrEqual(5)
    expect(Object.keys(analytics.registrationsByStatus).sort()).toEqual(
      ['ATTENDED', 'CANCELLED', 'CONFIRMED', 'NO_SHOW', 'PAYMENT_PENDING', 'PENDING', 'REFUNDED'].sort(),
    )
    expect(analytics.liveMuns).toBeGreaterThanOrEqual(1)
  })

  it('counts organizers created in the 7 days before `now`, and nothing else', async () => {
    const admin = await makeUser('ADMIN')
    // A far-future "now" keeps this window free of rows from other runs.
    const now = new Date(Date.UTC(2150, 0, 1 + Math.floor(Math.random() * 300)))
    const day = 24 * 60 * 60 * 1000
    await makeUser('ORGANIZER', { createdAt: new Date(now.getTime() - 2 * day) })
    await makeUser('ORGANIZER', { createdAt: new Date(now.getTime() - 6 * day) })
    await makeUser('ORGANIZER', { createdAt: new Date(now.getTime() - 8 * day) })
    await makeUser('STUDENT', { createdAt: new Date(now.getTime() - 1 * day) })

    const analytics = await getAdminAnalytics(sess(admin), now)
    expect(analytics.newOrganizersLast7Days).toBe(2)
    expect(analytics.generatedAt).toEqual(now)
  })

  it.each(['STUDENT', 'ORGANIZER'] as const)('refuses a %s session', async (role) => {
    const user = await makeUser(role)
    await expect(getAdminAnalytics(sess(user))).rejects.toThrow('Forbidden')
  })

  it('refuses no session', async () => {
    await expect(getAdminAnalytics(null)).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
