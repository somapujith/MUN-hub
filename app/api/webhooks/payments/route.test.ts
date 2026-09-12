import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { simulatePaymentOutcome } from '@/lib/payments/mock-adapter'
import { POST } from './route'

function sign(body: string): string {
  return crypto.createHmac('sha256', process.env.MOCK_PAYMENT_WEBHOOK_SECRET!).update(body).digest('hex')
}

async function seedPendingPayment() {
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Org', email: `org-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
    .returning()
  const [student] = await db
    .insert(users)
    .values({ name: 'Student', email: `stu-${Date.now()}-${Math.random()}@test.com`, role: 'STUDENT' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Webhook Mun', slug: `webhook-mun-${Date.now()}-${Math.random()}` })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 2500, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PAYMENT_PENDING' })
    .returning()

  const orderId = `mock_order_${registration.id}_${Date.now()}`
  const [payment] = await db
    .insert(payments)
    .values({ registrationId: registration.id, providerOrderId: orderId, amount: product.price, status: 'PENDING' })
    .returning()

  return { registration, payment, orderId }
}

function makeRequest(payload: string, signature: string): Request {
  return new Request('http://localhost/api/webhooks/payments', {
    method: 'POST',
    body: payload,
    headers: { 'x-webhook-signature': signature },
  })
}

describe('POST /api/webhooks/payments', () => {
  it('confirms registration + payment on a valid signed webhook', async () => {
    const { registration, orderId } = await seedPendingPayment()
    const { payload, signature } = await simulatePaymentOutcome(orderId, 'success')

    const response = await POST(makeRequest(payload, signature))
    expect(response.status).toBe(200)

    const [updatedPayment] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, orderId))
      .limit(1)
    expect(updatedPayment.status).toBe('PAID')
    expect(updatedPayment.providerPaymentId).toBeTruthy()

    const [updatedRegistration] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, registration.id))
      .limit(1)
    expect(updatedRegistration.status).toBe('CONFIRMED')
  })

  it('rejects an invalid signature with 400 and does not touch the payment', async () => {
    const { orderId } = await seedPendingPayment()
    const payload = JSON.stringify({ orderId, status: 'paid' })

    const response = await POST(makeRequest(payload, 'not-a-real-signature'))
    expect(response.status).toBe(400)

    const [payment] = await db.select().from(payments).where(eq(payments.providerOrderId, orderId)).limit(1)
    expect(payment.status).toBe('PENDING')
  })

  it('returns 404 for an unknown providerOrderId', async () => {
    const { payload, signature } = await simulatePaymentOutcome('mock_order_does_not_exist', 'success')
    const response = await POST(makeRequest(payload, signature))
    expect(response.status).toBe(404)
  })

  it('idempotently no-ops a replayed webhook for an already-PAID payment', async () => {
    const { registration, orderId } = await seedPendingPayment()
    const { payload, signature } = await simulatePaymentOutcome(orderId, 'success')

    const first = await POST(makeRequest(payload, signature))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.alreadyConfirmed).toBeUndefined()

    const second = await POST(makeRequest(payload, signature))
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.alreadyConfirmed).toBe(true)

    // Still confirmed exactly once, no double-processing side effects.
    const [updatedRegistration] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, registration.id))
      .limit(1)
    expect(updatedRegistration.status).toBe('CONFIRMED')
  })

  it('marks payment FAILED and releases the registration (not stuck in PAYMENT_PENDING) on a failure webhook', async () => {
    const { registration, orderId } = await seedPendingPayment()
    const { payload, signature } = await simulatePaymentOutcome(orderId, 'failure')

    const response = await POST(makeRequest(payload, signature))
    expect(response.status).toBe(200)

    const [updatedPayment] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, orderId))
      .limit(1)
    expect(updatedPayment.status).toBe('FAILED')

    const [updatedRegistration] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, registration.id))
      .limit(1)
    // A failed payment must release the held seat, not leave the
    // registration stuck at PAYMENT_PENDING with no retry path (the
    // payment row's unique registrationId blocks a second payment row
    // for the same registration).
    expect(updatedRegistration.status).toBe('CANCELLED')
  })

  it('does not resurrect a registration whose reservation already expired and was cancelled', async () => {
    const { registration, orderId } = await seedPendingPayment()

    await db
      .update(registrations)
      .set({ status: 'CANCELLED' })
      .where(eq(registrations.id, registration.id))

    const { payload, signature } = await simulatePaymentOutcome(orderId, 'success')
    const response = await POST(makeRequest(payload, signature))
    expect(response.status).toBe(200)

    const [updatedRegistration] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, registration.id))
      .limit(1)
    // A late/replayed "paid" webhook must never flip an already-cancelled
    // (expired-and-released) registration back to CONFIRMED.
    expect(updatedRegistration.status).toBe('CANCELLED')
  })

  it('rejects a payload that is not a JSON object instead of crashing', async () => {
    const body = 'null'
    const response = await POST(makeRequest(body, sign(body)))
    expect(response.status).toBe(400)
  })
})

afterAll(async () => {
  await db.$client.end()
})
