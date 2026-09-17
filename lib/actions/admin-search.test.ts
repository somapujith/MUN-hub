import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { adminActions, muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { PAYMENT_EXCEPTION_ERRORS } from '@/lib/payments/exceptions'
import { listPaymentExceptions, resolvePaymentException, searchRegistrations } from './admin-search'
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
  paymentStatus: 'PAID' | 'FAILED' | 'REFUNDED' | 'PENDING',
  registrationStatus: 'CONFIRMED' | 'PAYMENT_PENDING' | 'CANCELLED',
  exception: { reason: string; raisedAt?: Date } | null = null,
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
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      providerOrderId: `order-${Date.now()}-${Math.random()}`,
      amount: 50000,
      status: paymentStatus,
      exceptionReason: exception?.reason ?? null,
      exceptionRaisedAt: exception ? (exception.raisedAt ?? new Date()) : null,
    })
    .returning()
  return { mun, student, registration, payment }
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
  it('lists an open stored exception with delegate, MUN, amount and raised-at', async () => {
    const raisedAt = new Date()
    const { registration, payment, student, mun } = await seedRegistrationWithPayment('PAID', 'CANCELLED', {
      reason: 'PAYMENT_AFTER_HOLD_EXPIRED',
      raisedAt,
    })
    const ops = await makeUser('OPERATIONS')

    const { results } = await listPaymentExceptions({}, sess(ops))
    const row = results.find((e) => e.paymentId === payment.id)
    expect(row).toMatchObject({
      registrationId: registration.id,
      reason: 'PAYMENT_AFTER_HOLD_EXPIRED',
      amount: 50000,
      currency: 'INR',
      paymentStatus: 'PAID',
      registrationStatus: 'CANCELLED',
      studentName: student.name,
      studentEmail: student.email,
      munName: mun.name,
      resolvedAt: null,
    })
    expect(row?.raisedAt.getTime()).toBe(raisedAt.getTime())
  })

  it('surfaces a legacy REFUNDED (late-payment) row as PAYMENT_AFTER_HOLD_EXPIRED', async () => {
    const { payment } = await seedRegistrationWithPayment('REFUNDED', 'CANCELLED')
    const ops = await makeUser('OPERATIONS')
    const row = (await listPaymentExceptions({}, sess(ops))).results.find((e) => e.paymentId === payment.id)
    expect(row?.reason).toBe('PAYMENT_AFTER_HOLD_EXPIRED')
    expect(row?.raisedAt).toBeInstanceOf(Date)
  })

  it('does not treat a failed payment as an exception (no money was taken)', async () => {
    const { registration } = await seedRegistrationWithPayment('FAILED', 'CANCELLED')
    const ops = await makeUser('OPERATIONS')
    const { results } = await listPaymentExceptions({}, sess(ops))
    expect(results.some((e) => e.registrationId === registration.id)).toBe(false)
  })

  it('excludes a healthy PAID+CONFIRMED payment', async () => {
    const { registration } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const ops = await makeUser('OPERATIONS')

    const { results } = await listPaymentExceptions({}, sess(ops))
    expect(results.some((e) => e.registrationId === registration.id)).toBe(false)
  })

  it('excludes a resolved exception from the default (open) list', async () => {
    const { payment } = await seedRegistrationWithPayment('PAID', 'CONFIRMED', { reason: 'DUPLICATE_PAYMENT' })
    const ops = await makeUser('OPERATIONS')
    await resolvePaymentException(payment.id, 'Extra charge returned', sess(ops))
    const { results } = await listPaymentExceptions({}, sess(ops))
    expect(results.some((e) => e.paymentId === payment.id)).toBe(false)
  })

  it('lists newest first', async () => {
    const older = await seedRegistrationWithPayment('PAID', 'CANCELLED', {
      reason: 'PAYMENT_AFTER_HOLD_EXPIRED',
      raisedAt: new Date(Date.now() + 60_000),
    })
    const newer = await seedRegistrationWithPayment('PENDING', 'PAYMENT_PENDING', {
      reason: 'AMOUNT_MISMATCH',
      raisedAt: new Date(Date.now() + 120_000),
    })
    const ops = await makeUser('OPERATIONS')
    const ids = (await listPaymentExceptions({}, sess(ops))).results.map((e) => e.paymentId)
    expect(ids.indexOf(newer.payment.id)).toBeLessThan(ids.indexOf(older.payment.id))
  })

  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    await expect(listPaymentExceptions({}, sess(student))).rejects.toThrow('Forbidden')
  })
})

describe('resolvePaymentException', () => {
  it('records who resolved it, when, and why — with an admin audit entry', async () => {
    const { payment, registration } = await seedRegistrationWithPayment('PAID', 'CANCELLED', {
      reason: 'PAYMENT_AFTER_HOLD_EXPIRED',
    })
    const ops = await makeUser('OPERATIONS')

    const resolved = await resolvePaymentException(payment.id, '  Returned via bank transfer, UTR 1234  ', sess(ops))
    expect(resolved).toMatchObject({
      paymentId: payment.id,
      reason: 'PAYMENT_AFTER_HOLD_EXPIRED',
      resolvedBy: ops.id,
      note: 'Returned via bank transfer, UTR 1234',
    })

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(row.exceptionResolvedAt).toBeInstanceOf(Date)
    expect(row.exceptionResolvedBy).toBe(ops.id)
    expect(row.exceptionResolutionNote).toBe('Returned via bank transfer, UTR 1234')
    expect(row.status).toBe('PAID')

    const [audit] = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetType, 'payment'), eq(adminActions.targetId, payment.id)))
    expect(audit).toMatchObject({
      actorId: ops.id,
      action: 'PAYMENT_DETAILS_CHANGED',
      reason: 'Returned via bank transfer, UTR 1234',
      metadata: expect.objectContaining({
        kind: 'PAYMENT_EXCEPTION_RESOLVED',
        exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED',
        registrationId: registration.id,
      }),
    })
  })

  it('writes down the implied reason when resolving a legacy REFUNDED row', async () => {
    const { payment } = await seedRegistrationWithPayment('REFUNDED', 'CANCELLED')
    const admin = await makeUser('ADMIN')
    await resolvePaymentException(payment.id, 'Returned', sess(admin))
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(row.exceptionReason).toBe('PAYMENT_AFTER_HOLD_EXPIRED')
    expect(row.exceptionRaisedAt).toBeInstanceOf(Date)
    expect(row.status).toBe('REFUNDED')
  })

  it('requires a note', async () => {
    const { payment } = await seedRegistrationWithPayment('PAID', 'CANCELLED', { reason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
    const ops = await makeUser('OPERATIONS')
    await expect(resolvePaymentException(payment.id, '   ', sess(ops))).rejects.toThrow(
      PAYMENT_EXCEPTION_ERRORS.noteRequired,
    )
    await expect(resolvePaymentException(payment.id, 'x'.repeat(2001), sess(ops))).rejects.toThrow(
      PAYMENT_EXCEPTION_ERRORS.noteTooLong,
    )
  })

  it('refuses a second resolution', async () => {
    const { payment } = await seedRegistrationWithPayment('PAID', 'CANCELLED', { reason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
    const ops = await makeUser('OPERATIONS')
    await resolvePaymentException(payment.id, 'Done', sess(ops))
    await expect(resolvePaymentException(payment.id, 'Again', sess(ops))).rejects.toThrow(
      PAYMENT_EXCEPTION_ERRORS.alreadyResolved,
    )
  })

  it('refuses a payment with no exception, and an unknown id', async () => {
    const { payment } = await seedRegistrationWithPayment('PAID', 'CONFIRMED')
    const failed = await seedRegistrationWithPayment('FAILED', 'CANCELLED')
    const ops = await makeUser('OPERATIONS')
    for (const id of [payment.id, failed.payment.id, crypto.randomUUID()]) {
      await expect(resolvePaymentException(id, 'Nothing to do', sess(ops))).rejects.toThrow(
        PAYMENT_EXCEPTION_ERRORS.notFound,
      )
    }
  })

  it('is staff-only', async () => {
    const { payment } = await seedRegistrationWithPayment('PAID', 'CANCELLED', { reason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
    for (const role of ['STUDENT', 'ORGANIZER'] as const) {
      const user = await makeUser(role)
      await expect(resolvePaymentException(payment.id, 'Mine now', sess(user))).rejects.toThrow('Forbidden')
    }
    await expect(resolvePaymentException(payment.id, 'Anon', null)).rejects.toThrow('Forbidden')
  })
})
