import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { listPaymentExceptions, resolvePaymentException } from './exceptions'
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
  munName?: string
}): Promise<string> {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: opts.munName ?? 'Exceptions Mun', slug: `exceptions-${crypto.randomUUID()}` })
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

describe('listPaymentExceptions', () => {
  it('lists mock checkout rows only while the mock adapter is active', async () => {
    const admin = await makeUser('ADMIN')
    const session: Session = { userId: admin.id, role: 'ADMIN' }
    const late = PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired
    const real = await capturedPayment({ provider: 'razorpay', status: 'PAID', exceptionReason: late })
    const realLegacy = await capturedPayment({ provider: 'razorpay', status: 'REFUNDED', exceptionReason: null })
    const mock = await capturedPayment({ provider: MOCK_PROVIDER, status: 'PAID', exceptionReason: late })
    const mockLegacy = await capturedPayment({ provider: MOCK_PROVIDER, status: 'REFUNDED', exceptionReason: null })

    const listedIds = async () => new Set((await listPaymentExceptions({}, session)).results.map((row) => row.paymentId))

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

  it('paginates with total reflecting the whole match set, not just the page', async () => {
    const admin = await makeUser('ADMIN')
    const session: Session = { userId: admin.id, role: 'ADMIN' }
    const late = PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired
    // A unique MUN-name marker + `search` scopes both pages to only the rows
    // this test creates — the shared local DB already has dozens of other
    // open exceptions from other fixtures/sessions, so asserting on raw
    // `total`/page contents without scoping down first is not reliable.
    const marker = `Pagination Mun ${crypto.randomUUID()}`
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) {
      ids.push(await capturedPayment({ provider: MOCK_PROVIDER, status: 'PAID', exceptionReason: late, munName: marker }))
    }
    vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'true')

    const firstPage = await listPaymentExceptions({ search: marker, limit: 2, offset: 0 }, session)
    const secondPage = await listPaymentExceptions({ search: marker, limit: 2, offset: 2 }, session)

    expect(firstPage.results).toHaveLength(2)
    expect(firstPage.total).toBe(3)
    expect(secondPage.results).toHaveLength(1)
    const firstIds = new Set(firstPage.results.map((r) => r.paymentId))
    expect(firstIds.has(secondPage.results[0].paymentId)).toBe(false)
    for (const id of ids) {
      expect(firstPage.results.some((r) => r.paymentId === id) || secondPage.results.some((r) => r.paymentId === id)).toBe(true)
    }
  })

  it('filters by status: open excludes resolved and vice versa', async () => {
    const admin = await makeUser('ADMIN')
    const session: Session = { userId: admin.id, role: 'ADMIN' }
    const late = PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired
    const paymentId = await capturedPayment({ provider: MOCK_PROVIDER, status: 'PAID', exceptionReason: late })
    vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'true')

    const openBefore = await listPaymentExceptions({ status: 'open' }, session)
    expect(openBefore.results.some((r) => r.paymentId === paymentId)).toBe(true)

    await resolvePaymentException(paymentId, 'Returned off-platform', session)

    const openAfter = await listPaymentExceptions({ status: 'open' }, session)
    expect(openAfter.results.some((r) => r.paymentId === paymentId)).toBe(false)

    const resolved = await listPaymentExceptions({ status: 'resolved' }, session)
    const resolvedRow = resolved.results.find((r) => r.paymentId === paymentId)
    expect(resolvedRow).toBeDefined()
    expect(resolvedRow?.resolvedAt).toBeInstanceOf(Date)
    expect(resolvedRow?.resolvedByUserId).toBe(admin.id)
    expect(resolvedRow?.resolutionNote).toBe('Returned off-platform')
  })

  it('searches by delegate email and by MUN name', async () => {
    const admin = await makeUser('ADMIN')
    const session: Session = { userId: admin.id, role: 'ADMIN' }
    const late = PAYMENT_EXCEPTION_REASONS.paymentAfterHoldExpired
    const paymentId = await capturedPayment({ provider: MOCK_PROVIDER, status: 'PAID', exceptionReason: late })
    vi.stubEnv('MOCK_PAYMENTS_ENABLED', 'true')

    const [row] = (await listPaymentExceptions({}, session)).results.filter((r) => r.paymentId === paymentId)
    expect(row).toBeDefined()

    const byEmail = await listPaymentExceptions({ search: row.studentEmail.slice(0, 8) }, session)
    expect(byEmail.results.some((r) => r.paymentId === paymentId)).toBe(true)

    const byMunName = await listPaymentExceptions({ search: 'Exceptions Mun' }, session)
    expect(byMunName.results.some((r) => r.paymentId === paymentId)).toBe(true)

    const byNoMatch = await listPaymentExceptions({ search: `no-such-thing-${crypto.randomUUID()}` }, session)
    expect(byNoMatch.results.some((r) => r.paymentId === paymentId)).toBe(false)
  })
})
