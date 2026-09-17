import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { isEmailNotificationsEnabled } from './email-preference'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

// -----------------------------------------------------------------------------
// registration-events — delegate-facing optional emails for the registration/
// payment lifecycle (registration confirmed, payment failed, seat hold
// expired). Each function is a single call a payments/registration-lane
// caller adds after their own transaction commits — mirrors every other
// notify-after-commit convention in this codebase (see pipeline-events.ts /
// go-live.ts's file header). No refunds anywhere in this product (see
// payments.exceptionReason's schema comment) — none of these emails ever
// mention a refund.
// -----------------------------------------------------------------------------

export interface RegistrationEmailContext {
  userId: string
  userEmail: string
  userName: string
  munName: string
  productName: string
  /** Minor currency units (paise for INR), same unit `payments.amount`/`registrationProducts.price` use. */
  amount: number
  currency: string
}

/** Throws if the registration (or its product/mun/user) can't be found — a notify call site with a bad id has a real data-integrity problem worth surfacing, not silently skipping. */
async function resolveRegistrationEmailContext(registrationId: string): Promise<RegistrationEmailContext> {
  const [row] = await db
    .select({
      userId: registrations.userId,
      userEmail: users.email,
      userName: users.name,
      munName: muns.name,
      productName: registrationProducts.name,
      amount: registrationProducts.price,
      currency: registrationProducts.currency,
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .innerJoin(muns, eq(registrations.munId, muns.id))
    .innerJoin(registrationProducts, eq(registrations.registrationProductId, registrationProducts.id))
    .where(eq(registrations.id, registrationId))
    .limit(1)

  if (!row) throw new Error('Registration not found')
  return row
}

/** `payments.amount` (the actual amount charged, including any fee adjustments) when a payment row exists; falls back to the product's list price otherwise. */
async function resolvePaidAmount(registrationId: string, fallback: number): Promise<number> {
  const [row] = await db.select({ amount: payments.amount }).from(payments).where(eq(payments.registrationId, registrationId)).limit(1)
  return row?.amount ?? fallback
}

function formatMoney(amountMinorUnits: number, currency: string): string {
  return `${currency} ${(amountMinorUnits / 100).toFixed(2)}`
}

async function sendIfOptedIn(userId: string, to: string, subject: string, body: string, adapter: NotificationsAdapter): Promise<void> {
  if (!(await isEmailNotificationsEnabled(userId))) return
  try {
    await adapter.send({ to, subject, body })
  } catch (error) {
    console.error('[registration-notification] delivery failed', { userId, subject, error })
  }
}

/** Registration confirmed — sent once a payment has actually confirmed the seat, with a plain-text receipt. */
export async function notifyRegistrationConfirmed(
  registrationId: string,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const context = await resolveRegistrationEmailContext(registrationId)
  const amount = await resolvePaidAmount(registrationId, context.amount)

  await sendIfOptedIn(
    context.userId,
    context.userEmail,
    `Registration confirmed — ${context.munName}`,
    `Hi ${context.userName},\n\n` +
      `Your registration for "${context.munName}" is confirmed.\n\n` +
      `Receipt\n` +
      `-------\n` +
      `Product: ${context.productName}\n` +
      `Amount paid: ${formatMoney(amount, context.currency)}\n` +
      `Registration ID: ${registrationId}\n\n` +
      `See you at the conference!`,
    adapter,
  )
}

/** Payment failed — the webhook marked the payment FAILED and released the seat hold. */
export async function notifyPaymentFailed(
  registrationId: string,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const context = await resolveRegistrationEmailContext(registrationId)

  await sendIfOptedIn(
    context.userId,
    context.userEmail,
    `Payment failed — ${context.munName}`,
    `Hi ${context.userName},\n\n` +
      `Your payment for "${context.munName}" (${context.productName}) didn't go through, and your seat hold has been released.\n\n` +
      `You can try registering again from the MUN Hub site whenever you're ready.`,
    adapter,
  )
}

/** Seat hold expired — the reservation TTL ran out before payment completed (never a payment failure, no charge was ever attempted). */
export async function notifySeatHoldExpired(
  registrationId: string,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const context = await resolveRegistrationEmailContext(registrationId)

  await sendIfOptedIn(
    context.userId,
    context.userEmail,
    `Your seat hold expired — ${context.munName}`,
    `Hi ${context.userName},\n\n` +
      `Your reserved seat for "${context.munName}" (${context.productName}) expired before payment was completed, so it's been released back to general availability.\n\n` +
      `You're welcome to start a new registration from the MUN Hub site if you'd still like to attend.`,
    adapter,
  )
}
