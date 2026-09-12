import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { payments, registrations } from '@/lib/db/schema'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'

interface WebhookPayload {
  orderId: string
  status: 'paid' | 'failed'
  providerPaymentId?: string
}

/**
 * Payments provider webhook (mock Razorpay-shaped). Per PRD Section 17/25:
 * the frontend is never trusted as final payment authority — confirmation
 * only happens here, server-side, after verifying the provider's signature.
 *
 * Flow:
 *   1. Read the raw body text (never parse-then-reserialize before verifying
 *      — signatures are computed over the exact bytes sent).
 *   2. Verify signature via the payments adapter. 400 if invalid.
 *   3. Look up the payment by providerOrderId. 404 if not found.
 *   4. If already PAID, return 200 idempotently without reprocessing (a
 *      replayed/duplicate webhook must never double-confirm).
 *   5. Otherwise, in one transaction: mark payment PAID (+providerPaymentId)
 *      and registration CONFIRMED.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text()
  const signature = request.headers.get('x-webhook-signature') ?? ''

  if (!mockPaymentsAdapter.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const payload = parsed as WebhookPayload

  if (!payload.orderId || typeof payload.orderId !== 'string') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (payload.status !== 'paid' && payload.status !== 'failed') {
    // Reject anything that isn't an explicit known outcome instead of
    // silently treating unrecognized values (wrong casing, a future status
    // the mock adapter doesn't know about, undefined) as a failure.
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerOrderId, payload.orderId))
    .limit(1)

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  }

  if (payment.status === 'PAID') {
    // Idempotent replay: already processed, never double-confirm.
    return NextResponse.json({ ok: true, alreadyConfirmed: true }, { status: 200 })
  }

  if (payload.status === 'failed') {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id))

      // Release the held seat: a failed payment must not keep the
      // registration (and its reserved capacity) alive for the rest of the
      // reservation TTL with no way to retry (the payment row's unique
      // registrationId means a second initiateRegistration call needs this
      // registration cancelled, not stuck in PAYMENT_PENDING).
      await tx
        .update(registrations)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(registrations.id, payment.registrationId), eq(registrations.status, 'PAYMENT_PENDING')))
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  await db.transaction(async (tx) => {
    const updatedPayment = await tx
      .update(payments)
      .set({
        status: 'PAID',
        providerPaymentId: payload.providerPaymentId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning({ id: payments.id })

    if (updatedPayment.length === 0) {
      return
    }

    // Only confirm a registration that is still PAYMENT_PENDING — a late or
    // replayed webhook must never resurrect a registration whose reservation
    // already expired and was released (status CANCELLED) back to CONFIRMED.
    await tx
      .update(registrations)
      .set({ status: 'CONFIRMED', updatedAt: new Date() })
      .where(and(eq(registrations.id, payment.registrationId), eq(registrations.status, 'PAYMENT_PENDING')))
  })

  return NextResponse.json({ ok: true }, { status: 200 })
}
