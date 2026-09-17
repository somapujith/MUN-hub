/**
 * Database helpers for the payment specs: the early-bird pricing fixture MUN
 * (FIXTURE_MUNS.pricing) and direct reads of payment rows the API never
 * exposes (fee split, exception columns). Kept apart from fixture-db.ts, like
 * ops-fixture-db.ts, so the payment specs own their fixture end to end.
 * Local database only (withFixtureDb asserts it).
 */
import { and, count, eq } from 'drizzle-orm'
import * as schema from '../../lib/db/schema'
import { deleteMunBySlug, ensureCommittee, ensureProduct, organizerId, upsertMun, withFixtureDb } from './fixture-db'
import { PRICING } from './fixture-muns'

const DAY = 24 * 60 * 60 * 1000

/**
 * Deletes and recreates the pricing MUN (new id, no registrations or
 * payments), REGISTRATION_OPEN and owned by the seeded organizer, with each
 * pass's early-bird price and deadline set from its definition. Returns its id.
 */
export async function recreatePricingMun(): Promise<string> {
  return withFixtureDb(async (db) => {
    const ownerId = await organizerId(db)
    return db.transaction(async (tx) => {
      await deleteMunBySlug(tx, PRICING.slug)
      const munId = await upsertMun(tx, ownerId, PRICING, 'REGISTRATION_OPEN')
      for (const c of PRICING.committees) await ensureCommittee(tx, munId, c)
      for (const p of PRICING.products) {
        await ensureProduct(tx, munId, p)
        await tx
          .update(schema.registrationProducts)
          .set({
            earlyBirdPrice: p.earlyBird.price,
            earlyBirdDeadline: new Date(Date.now() + p.earlyBird.daysFromNow * DAY),
          })
          .where(and(eq(schema.registrationProducts.munId, munId), eq(schema.registrationProducts.name, p.name)))
      }
      return munId
    })
  })
}

export interface StoredPayment {
  id: string
  status: string
  provider: string
  providerOrderId: string
  providerPaymentId: string | null
  amount: number
  currency: string
  platformFeeAmount: number | null
  platformFeeTaxAmount: number | null
  organizerNetAmount: number | null
  exceptionReason: string | null
  exceptionRaisedAt: Date | null
  exceptionResolvedAt: Date | null
  exceptionResolutionNote: string | null
}

/** The payment row of a registration, straight from the database (undefined if none). */
export async function paymentFor(registrationId: string): Promise<StoredPayment | undefined> {
  return withFixtureDb(async (db) => {
    const [row] = await db
      .select({
        id: schema.payments.id,
        status: schema.payments.status,
        provider: schema.payments.provider,
        providerOrderId: schema.payments.providerOrderId,
        providerPaymentId: schema.payments.providerPaymentId,
        amount: schema.payments.amount,
        currency: schema.payments.currency,
        platformFeeAmount: schema.payments.platformFeeAmount,
        platformFeeTaxAmount: schema.payments.platformFeeTaxAmount,
        organizerNetAmount: schema.payments.organizerNetAmount,
        exceptionReason: schema.payments.exceptionReason,
        exceptionRaisedAt: schema.payments.exceptionRaisedAt,
        exceptionResolvedAt: schema.payments.exceptionResolvedAt,
        exceptionResolutionNote: schema.payments.exceptionResolutionNote,
      })
      .from(schema.payments)
      .where(eq(schema.payments.registrationId, registrationId))
    return row
  })
}

/** A registration's status, straight from the database. */
export async function registrationStatus(registrationId: string): Promise<string | undefined> {
  return withFixtureDb(async (db) => {
    const [row] = await db
      .select({ status: schema.registrations.status })
      .from(schema.registrations)
      .where(eq(schema.registrations.id, registrationId))
    return row?.status
  })
}

/** How many registrations (any status) a user has on a MUN. */
export async function registrationCount(userId: string, munId: string): Promise<number> {
  return withFixtureDb(async (db) => {
    const [row] = await db
      .select({ n: count() })
      .from(schema.registrations)
      .where(and(eq(schema.registrations.userId, userId), eq(schema.registrations.munId, munId)))
    return row.n
  })
}

/**
 * Moves a registration's seat hold into the past, as if its 15 minutes had
 * run out. The seat is released by the next sweep (any availability read or
 * registration attempt on that pass), exactly as it would be in production.
 */
export async function expireSeatHold(registrationId: string): Promise<void> {
  await withFixtureDb(async (db) => {
    await db
      .update(schema.registrations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.registrations.id, registrationId))
  })
}
