import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { listOpenPaymentExceptions } from './exceptions'
import { PAYMENT_EXCEPTION_REASONS } from './exception-reasons'
import { MOCK_PROVIDER } from './mock-adapter'

async function makeUser(role: 'ORGANIZER' | 'ADMIN' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function capturedPayment(opts: {
  provider: string
  status: 'PAID' | 'REFUNDED'
  exceptionReason: string | null
}): Promise<string> {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Exceptions Mun', slug: `exceptions-${crypto.randomUUID()}` })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 1499, capacity: 10 })
    .returning()
  const delegate = await makeUser('STUDENT')
  const [registration] = await db
    .insert(registrations)
    .values({ userId: delegate.id, munId: mun.id, registrationProductId: product.id, status: 'CANCELLED' })
    .returning()
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      provider: opts.provider,
      providerOrderId: `order-${crypto.randomUUID()}`,
      providerPaymentId: `pay-${crypto.randomUUID()}`,
      amount: 1499,
      status: opts.status,
      exceptionReason: opts.exceptionReason,
      exceptionRaisedAt: opts.exceptionReason ? new Date() : null,
    })
    .returning({ id: payments.id })
  return payment.id
}

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await db.$client.end()
})

describe('listOpenPaymentExceptions', () => {
  it('lists mock checkout rows only while the mock adapter is active', async () => {
    const admin = await makeUser('ADMIN')
    const session: Session = { userId: admin.id, role: 'ADMIN' }
    const late = PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired
    const real = await capturedPayment({ provider: 'razorpay', status: 'PAID', exceptionReason: late })
    const realLegacy = await capturedPayment({ provider: 'razorpay', status: 'REFUNDED', exceptionReason: null })
    const mock = await capturedPayment({ provider: MOCK_PROVIDER, status: 'PAID', exceptionReason: late })
    const mockLegacy = await capturedPayment({ provider: MOCK_PROVIDER, status: 'REFUNDED', exceptionReason: null })

    const listedIds = async () => new Set((await listOpenPaymentExceptions(session)).map((row) => row.paymentId))

    vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'true')
    const withMock = await listedIds()
    for (const id of [real, realLegacy, mock, mockLegacy]) expect(withMock.has(id)).toBe(true)

    // Deployed with the mock switched off: mock rows took no money, so there
    // is nothing to return.
    vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'false')
    const withoutMock = await listedIds()
    expect(withoutMock.has(real)).toBe(true)
    expect(withoutMock.has(realLegacy)).toBe(true)
    expect(withoutMock.has(mock)).toBe(false)
    expect(withoutMock.has(mockLegacy)).toBe(false)
  })
})
