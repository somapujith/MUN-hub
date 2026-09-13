import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session'

// Mock next/headers `cookies()` so getSession() (called internally by every
// admin-search action) can read a token we control per-test, without a real
// Next.js request context. Same pattern as lib/actions/admin-review.test.ts
// and lib/actions/organizer-admin.test.ts.
let currentToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && currentToken ? { value: currentToken } : undefined),
  }),
}))

import { listPaymentExceptions, searchRegistrations } from './admin-search'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `${role}-${Date.now()}-${Math.random()}`, email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.dev`, role })
    .returning()
  return user
}

async function sessionFor(userId: string) {
  const { token } = await createSession(userId)
  return token
}

async function seedRegistrationWithPayment(
  paymentStatus: 'PAID' | 'FAILED',
  registrationStatus: 'CONFIRMED' | 'PAYMENT_PENDING' | 'CANCELLED',
) {
  const organizer = await makeUser('ORGANIZER')
  const student = await makeUser('STUDENT')
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId: organizer.id,
      name: `Test Mun ${Date.now()}-${Math.random()}`,
      slug: `test-mun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 50000, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({
      userId: student.id,
      munId: mun.id,
      registrationProductId: product.id,
      status: registrationStatus,
    })
    .returning()
  await db.insert(payments).values({
    registrationId: registration.id,
    providerOrderId: `order-${Date.now()}-${Math.random()}`,
    amount: 50000,
    status: paymentStatus,
  })
  return { mun, student, registration }
}

describe('searchRegistrations', () => {
  it('finds a registration by student name substring', async () => {
    const { student, registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const results = await searchRegistrations(student.name)
    expect(results.some((r) => r.registrationId === registration.id)).toBe(true)
  })

  it('finds a registration by mun name substring', async () => {
    const { mun, registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const results = await searchRegistrations(mun.name)
    expect(results.some((r) => r.registrationId === registration.id)).toBe(true)
  })

  it('throws Forbidden for a student session', async () => {
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)
    await expect(searchRegistrations('anything')).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    currentToken = undefined
    await expect(searchRegistrations('anything')).rejects.toThrow('Forbidden')
  })
})

describe('listPaymentExceptions', () => {
  it('includes a FAILED payment', async () => {
    const { registration } = await seedRegistrationWithPayment('FAILED', 'PAYMENT_PENDING')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const exceptions = await listPaymentExceptions()
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(true)
  })

  it('includes a PAID payment whose registration is not CONFIRMED (webhook/registration mismatch)', async () => {
    const { registration } = await seedRegistrationWithPayment('PAID', 'CANCELLED')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const exceptions = await listPaymentExceptions()
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(true)
  })

  it('excludes a normal PAID + CONFIRMED pair', async () => {
    const { registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const exceptions = await listPaymentExceptions()
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(false)
  })

  it('throws Forbidden for a student session', async () => {
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)
    await expect(listPaymentExceptions()).rejects.toThrow('Forbidden')
  })
})
