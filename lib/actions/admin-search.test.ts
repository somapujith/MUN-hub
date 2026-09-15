import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { listPaymentExceptions, searchRegistrations } from './admin-search'
import type { Session } from '@/lib/auth/adapter'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `${role}-${Date.now()}-${Math.random()}`, email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.dev`, role })
    .returning()
  return user
}

function sess(user: { id: string; role: Session['role'] }): Session {
  return { userId: user.id, role: user.role }
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

    const results = await searchRegistrations(student.name, sess(ops))
    expect(results.some((r) => r.registrationId === registration.id)).toBe(true)
  })

  it('finds a registration by mun name substring', async () => {
    const { mun, registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const ops = await makeUser('OPERATIONS')

    const results = await searchRegistrations(mun.name, sess(ops))
    expect(results.some((r) => r.registrationId === registration.id)).toBe(true)
  })

  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    await expect(searchRegistrations('anything', sess(student))).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    await expect(searchRegistrations('anything', null)).rejects.toThrow('Forbidden')
  })
})

describe('listPaymentExceptions', () => {
  it('includes FAILED payments', async () => {
    const { registration } = await seedRegistrationWithPayment('FAILED', 'PAYMENT_PENDING')
    const ops = await makeUser('OPERATIONS')

    const exceptions = await listPaymentExceptions(sess(ops))
    expect(exceptions.some((e) => e.registrationId === registration.id && e.reason === 'PAYMENT_FAILED')).toBe(true)
  })

  it('includes PAID payments whose registration is not CONFIRMED', async () => {
    const { registration } = await seedRegistrationWithPayment('PAID', 'CANCELLED')
    const ops = await makeUser('OPERATIONS')

    const exceptions = await listPaymentExceptions(sess(ops))
    expect(exceptions.some((e) => e.registrationId === registration.id && e.reason === 'CONFIRMATION_MISMATCH')).toBe(true)
  })

  it('excludes a healthy PAID+CONFIRMED payment', async () => {
    const { registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const ops = await makeUser('OPERATIONS')

    const exceptions = await listPaymentExceptions(sess(ops))
    expect(exceptions.some((e) => e.registrationId === registration.id)).toBe(false)
  })

  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    await expect(listPaymentExceptions(sess(student))).rejects.toThrow('Forbidden')
  })
})
