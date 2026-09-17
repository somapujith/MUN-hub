import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { PaymentStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import { getMunAnalytics } from './mun-analytics'

afterAll(async () => {
  await db.$client.end()
})

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `analytics ${role}`, email: `analytics-${crypto.randomUUID()}@test.dev`, role })
    .returning()
  return user
}

describe('getMunAnalytics', () => {
  it('reports gross collected and net to the organizer per pass, from standing paid registrations only', async () => {
    const organizer = await makeUser('ORGANIZER')
    const delegate = await makeUser('STUDENT')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Analytics Mun', slug: `analytics-${crypto.randomUUID()}` })
      .returning()
    const [delegatePass, observerPass] = await db
      .insert(registrationProducts)
      .values([
        { munId: mun.id, name: 'Delegate', price: 2360, capacity: 10, displayOrder: 0 },
        { munId: mun.id, name: 'Observer', price: 1000, capacity: 5, displayOrder: 1 },
      ])
      .returning()

    async function paid(
      productId: string,
      status: RegistrationStatus,
      payment: { amount: number; status?: PaymentStatus; net?: number; fee?: number; tax?: number },
    ) {
      const [registration] = await db
        .insert(registrations)
        .values({ userId: delegate.id, munId: mun.id, registrationProductId: productId, status })
        .returning()
      await db.insert(payments).values({
        registrationId: registration.id,
        providerOrderId: `order-${crypto.randomUUID()}`,
        amount: payment.amount,
        status: payment.status ?? 'PAID',
        organizerNetAmount: payment.net,
        platformFeeAmount: payment.fee,
        platformFeeTaxAmount: payment.tax,
      })
    }

    // With a fee breakdown: 2360 paid, 2000 to the organizer.
    await paid(delegatePass.id, 'CONFIRMED', { amount: 2360, net: 2000, fee: 305, tax: 55 })
    await paid(delegatePass.id, 'ATTENDED', { amount: 2360, net: 2000, fee: 305, tax: 55 })
    // Late payment on a released seat (a payment exception): not revenue.
    await paid(delegatePass.id, 'CANCELLED', { amount: 2360, net: 2000, fee: 305, tax: 55 })
    // Not paid yet: not revenue.
    await paid(delegatePass.id, 'PAYMENT_PENDING', { amount: 2360, status: 'PENDING', net: 2000, fee: 305, tax: 55 })
    // Recorded before the fee model: no breakdown, all of it is the organizer's.
    await paid(observerPass.id, 'NO_SHOW', { amount: 1000 })

    const analytics = await getMunAnalytics(mun.id, { userId: organizer.id, role: 'ORGANIZER' })

    expect(analytics.products).toEqual([
      expect.objectContaining({ productId: delegatePass.id, registrationCount: 2, revenue: 4720, organizerNet: 4000 }),
      expect.objectContaining({ productId: observerPass.id, registrationCount: 0, revenue: 1000, organizerNet: 1000 }),
    ])
    expect(analytics).toMatchObject({ totalRegistrations: 2, totalRevenue: 5720, totalOrganizerNet: 5000 })
  })

  it('refuses an organizer who does not own the MUN', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: owner.id, name: 'Private Analytics Mun', slug: `analytics-${crypto.randomUUID()}` })
      .returning()

    await expect(getMunAnalytics(mun.id, { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })
})
