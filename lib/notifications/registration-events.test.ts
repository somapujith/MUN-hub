import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { notifyPaymentFailed, notifyRegistrationConfirmed, notifySeatHoldExpired } from './registration-events'
import type { NotificationsAdapter } from './adapter'

async function makeUser(emailNotificationsEnabled = true) {
  const [user] = await db
    .insert(users)
    .values({ name: 'Delegate', email: `delegate-${crypto.randomUUID()}@test.dev`, role: 'STUDENT', emailNotificationsEnabled })
    .returning()
  return user
}

async function makeRegistration(userId: string, price = 100000) {
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Org', email: `org-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Notify Registration Mun', slug: `notify-reg-${crypto.randomUUID()}` })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Standard Delegate', price, capacity: 20 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
    .returning()
  return { mun, product, registration }
}

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

describe('notifyRegistrationConfirmed', () => {
  it('sends a receipt with the product name and amount', async () => {
    const user = await makeUser()
    const { mun, registration } = await makeRegistration(user.id, 150000)
    const { adapter, send } = mockAdapter()

    await notifyRegistrationConfirmed(registration.id, adapter)

    expect(send).toHaveBeenCalledTimes(1)
    const call = send.mock.calls[0][0]
    expect(call.to).toBe(user.email)
    expect(call.subject).toContain(mun.name)
    expect(call.body).toContain('Standard Delegate')
    expect(call.body).toContain('1500.00')
  })

  it('uses the payments row amount over the product list price when a payment exists', async () => {
    const user = await makeUser()
    const { registration } = await makeRegistration(user.id, 150000)
    await db.insert(payments).values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      amount: 140000, // e.g. an early-bird discount applied at charge time
      status: 'PAID',
    })
    const { adapter, send } = mockAdapter()

    await notifyRegistrationConfirmed(registration.id, adapter)

    expect(send.mock.calls[0][0].body).toContain('1400.00')
  })

  it('does not send when the user has opted out of email notifications', async () => {
    const user = await makeUser(false)
    const { registration } = await makeRegistration(user.id)
    const { adapter, send } = mockAdapter()

    await notifyRegistrationConfirmed(registration.id, adapter)

    expect(send).not.toHaveBeenCalled()
  })

  it('throws for a registration id that does not resolve', async () => {
    const { adapter } = mockAdapter()
    await expect(notifyRegistrationConfirmed('00000000-0000-0000-0000-000000000000', adapter)).rejects.toThrow(
      'Registration not found',
    )
  })
})

describe('notifyPaymentFailed', () => {
  it('sends a payment-failed notice mentioning the seat hold release, never a refund', async () => {
    const user = await makeUser()
    const { registration } = await makeRegistration(user.id)
    const { adapter, send } = mockAdapter()

    await notifyPaymentFailed(registration.id, adapter)

    expect(send).toHaveBeenCalledTimes(1)
    const body = send.mock.calls[0][0].body as string
    expect(body).toContain('seat hold has been released')
    expect(body.toLowerCase()).not.toContain('refund')
  })
})

describe('notifySeatHoldExpired', () => {
  it('sends a seat-hold-expired notice, distinct copy from payment failure', async () => {
    const user = await makeUser()
    const { registration } = await makeRegistration(user.id)
    const { adapter, send } = mockAdapter()

    await notifySeatHoldExpired(registration.id, adapter)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].subject).toContain('seat hold expired')
  })
})
