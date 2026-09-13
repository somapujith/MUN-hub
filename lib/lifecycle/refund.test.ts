import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  adminActions,
  muns,
  payments,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { approveRefund, rejectRefund, requestRefund } from './refund'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

async function seedPaidRegistration() {
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Org', email: `o-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [student] = await db
    .insert(users)
    .values({ name: 'Student', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  const [otherStudent] = await db
    .insert(users)
    .values({ name: 'Other Student', email: `s2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  const [admin] = await db
    .insert(users)
    .values({ name: 'Admin', email: `admin-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Refund Mun', slug: `refund-mun-${crypto.randomUUID()}` })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 50000, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
    .returning()
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      providerPaymentId: `pay-${crypto.randomUUID()}`,
      amount: 50000,
      status: 'PAID',
    })
    .returning()
  return { student, otherStudent, admin, registration, payment }
}

describe('requestRefund', () => {
  it('creates a REQUESTED refund_requests row', async () => {
    const { student, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const req = await requestRefund(registration.id, 'conference cancelled')
    expect(req.status).toBe('REQUESTED')
    expect(req.paymentId).toBe(payment.id)
    expect(req.amount).toBe(50000)
  })

  it('throws Forbidden if the caller does not own the registration', async () => {
    const { otherStudent, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: otherStudent.id, role: 'STUDENT' })

    await expect(requestRefund(registration.id, 'not mine')).rejects.toThrow('Forbidden')
  })

  it('allows an admin to request a refund on a student registration', async () => {
    const { admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })

    const req = await requestRefund(registration.id, 'goodwill refund')
    expect(req.status).toBe('REQUESTED')
    expect(req.paymentId).toBe(payment.id)
  })

  it('throws for an unauthenticated caller', async () => {
    const { registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(requestRefund(registration.id, 'x')).rejects.toThrow('Forbidden')
  })
})

describe('approveRefund', () => {
  it('transitions REQUESTED -> REFUNDED, updates registration and payment status, logs REFUND_APPROVED', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'conference cancelled')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const approved = await approveRefund(req.id)
    expect(approved.status).toBe('REFUNDED')
    expect(approved.providerRefundId).toBeTruthy()

    const [updatedRegistration] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(updatedRegistration.status).toBe('REFUNDED')

    const [updatedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(updatedPayment.status).toBe('REFUNDED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, req.id))
    expect(log.action).toBe('REFUND_APPROVED')
  })

  it('throws Forbidden for a student session', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    await expect(approveRefund(req.id)).rejects.toThrow('Forbidden')
  })

  it('throws for a refund request that is not REQUESTED', async () => {
    const { student, admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await approveRefund(req.id)

    await expect(approveRefund(req.id)).rejects.toThrow(`Invalid transition from REFUNDED to REFUNDED`)
  })

  it('two concurrent approvals on the same request serialize (row lock, only one REFUNDED)', async () => {
    const { student, admin, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const [r1, r2] = await Promise.allSettled([approveRefund(req.id), approveRefund(req.id)])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
  })
})

describe('rejectRefund', () => {
  it('transitions REQUESTED -> REJECTED, logs REFUND_REJECTED, does not touch registration/payment', async () => {
    const { student, admin, registration, payment } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const rejected = await rejectRefund(req.id, 'not eligible')
    expect(rejected.status).toBe('REJECTED')

    const [reg] = await db.select().from(registrations).where(eq(registrations.id, registration.id))
    expect(reg.status).toBe('CONFIRMED')

    const [pay] = await db.select().from(payments).where(eq(payments.id, payment.id))
    expect(pay.status).toBe('PAID')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, req.id))
    expect(log.action).toBe('REFUND_REJECTED')
    expect(log.reason).toBe('not eligible')
  })

  it('throws Forbidden for a student session', async () => {
    const { student, registration } = await seedPaidRegistration()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const req = await requestRefund(registration.id, 'x')

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    await expect(rejectRefund(req.id, 'no')).rejects.toThrow('Forbidden')
  })
})
