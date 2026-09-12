'use server'

import { and, count, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { mockPaymentsAdapter } from '@/lib/payments/mock-adapter'
import type { RegistrationInput, RegistrationStatus } from '@/lib/types'

const RESERVATION_TTL_MS = 15 * 60 * 1000

const ACTIVE_REGISTRATION_STATUSES: RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED']
const RELEASABLE_STATUSES: RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING']

/**
 * Marks any PENDING/PAYMENT_PENDING registrations for `registrationProductId`
 * whose 15-minute reservation window has expired as CANCELLED, freeing their
 * seat. Called as a lazy sweep at the top of `initiateRegistration`'s
 * capacity check (no cron needed for MVP).
 *
 * Returns the number of registrations released.
 */
export async function releaseExpiredReservations(registrationProductId: string): Promise<number> {
  const released = await db
    .update(registrations)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(
      and(
        eq(registrations.registrationProductId, registrationProductId),
        inArray(registrations.status, RELEASABLE_STATUSES),
        lt(registrations.expiresAt, new Date()),
      ),
    )
    .returning({ id: registrations.id })

  return released.length
}

/**
 * Reserves a seat and starts the payment flow for the *currently
 * authenticated* user.
 *
 * SECURITY (IDOR): the acting user is derived exclusively from
 * `getSession()` — this function does NOT accept a caller-supplied
 * `userId`. `RegistrationInput.userId` is typed optional specifically so it
 * can never be required/trusted from the caller; it is ignored here even if
 * present. A previous draft accepted `userId` as an input field, which let
 * any caller register as an arbitrary user — do not reintroduce that.
 *
 * Throws `Error('Forbidden')` if there is no active session.
 * Throws `Error('Registration product is at capacity')` if full.
 *
 * Flow:
 *   1. Release expired reservations for this product (frees stale seats).
 *   2. In a transaction: count PENDING+PAYMENT_PENDING+CONFIRMED registrations
 *      against the product's capacity; if full, abort. Otherwise create a
 *      PENDING registration with a 15-minute expiresAt.
 *   3. After that transaction commits, call the payments adapter's
 *      createOrder() (external call — deliberately outside the DB
 *      transaction).
 *   4. In a second transaction, flip the registration to PAYMENT_PENDING and
 *      create the corresponding payment row.
 */
export async function initiateRegistration(
  input: Omit<RegistrationInput, 'userId'>,
): Promise<{ registrationId: string; orderId: string }> {
  const session = await getSession()
  if (!session) {
    throw new Error('Forbidden')
  }
  const userId = session.userId

  await releaseExpiredReservations(input.registrationProductId)

  const registration = await db.transaction(async (tx) => {
    // Row-lock the product for the duration of this transaction so concurrent
    // initiateRegistration calls for the same product serialize here instead
    // of all reading the same pre-insert count under READ COMMITTED (which
    // let N concurrent callers all pass the capacity check for a single
    // remaining seat — confirmed exploitable by red-team review).
    const [product] = await tx
      .select()
      .from(registrationProducts)
      .where(eq(registrationProducts.id, input.registrationProductId))
      .for('update')
      .limit(1)

    if (!product) {
      throw new Error('Registration product not found')
    }

    const activeRegistrations = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.registrationProductId, input.registrationProductId),
          inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
        ),
      )

    if (activeRegistrations.length >= product.capacity) {
      throw new Error('Registration product is at capacity')
    }

    const [created] = await tx
      .insert(registrations)
      .values({
        userId,
        munId: input.munId,
        registrationProductId: input.registrationProductId,
        committeeId: input.committeeId,
        portfolioId: input.portfolioId,
        formResponses: input.formResponses,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      })
      .returning()

    return { ...created, price: product.price, currency: product.currency }
  })

  const order = await mockPaymentsAdapter.createOrder(
    registration.price,
    registration.currency,
    registration.id,
  )

  await db.transaction(async (tx) => {
    await tx
      .update(registrations)
      .set({ status: 'PAYMENT_PENDING', updatedAt: new Date() })
      .where(eq(registrations.id, registration.id))

    await tx.insert(payments).values({
      registrationId: registration.id,
      providerOrderId: order.orderId,
      amount: registration.price,
      status: 'PENDING',
    })
  })

  return { registrationId: registration.id, orderId: order.orderId }
}

export interface RegistrationWithDetails {
  id: string
  userId: string
  munId: string
  registrationProductId: string
  committeeId: string | null
  portfolioId: string | null
  formResponses: unknown
  status: RegistrationStatus
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Fetches a registration by id, enforcing ownership: the caller must be the
 * registration's own user, OR ADMIN/SUPER_ADMIN, OR the organizer of the
 * registration's MUN.
 *
 * Returns null if the registration doesn't exist at all (no information
 * leak about existence is needed beyond that — a not-found and an
 * unauthorized-for-a-nonexistent-id both look like "not found" to an
 * unrelated caller, but once we know it exists we must throw Forbidden
 * rather than silently return null, so authorized callers still get a
 * correct null-vs-forbidden signal).
 *
 * Throws `Error('Forbidden')` if the registration exists but the caller is
 * not authorized to view it.
 */
export async function getRegistrationById(registrationId: string): Promise<RegistrationWithDetails | null> {
  const session = await getSession()
  if (!session) {
    throw new Error('Forbidden')
  }

  const [row] = await db
    .select({ registration: registrations })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1)

  if (!row) {
    return null
  }

  const { registration } = row

  const isOwner = registration.userId === session.userId
  const isPlatformAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'

  if (isOwner || isPlatformAdmin) {
    return registration
  }

  const isOrganizer = await isMunOrganizer(registration.munId, session.userId)
  if (isOrganizer) {
    return registration
  }

  throw new Error('Forbidden')
}

async function isMunOrganizer(munId: string, userId: string): Promise<boolean> {
  const [mun] = await db
    .select({ organizerId: muns.organizerId })
    .from(muns)
    .where(and(eq(muns.id, munId), eq(muns.organizerId, userId)))
    .limit(1)
  return Boolean(mun)
}

/**
 * Public read (no auth) — used by the registration picker UI to show live
 * seat counts. Deliberately excludes CANCELLED/REFUNDED from `taken` so a
 * released or refunded seat frees capacity immediately.
 */
export async function getProductAvailability(
  registrationProductId: string,
): Promise<{ capacity: number; taken: number; available: number }> {
  await releaseExpiredReservations(registrationProductId)

  const [product] = await db
    .select({ capacity: registrationProducts.capacity })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, registrationProductId))
    .limit(1)

  if (!product) {
    throw new Error('Registration product not found')
  }

  const [{ taken }] = await db
    .select({ taken: count() })
    .from(registrations)
    .where(
      and(
        eq(registrations.registrationProductId, registrationProductId),
        inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
      ),
    )

  const available = Math.max(product.capacity - taken, 0)

  return { capacity: product.capacity, taken, available }
}
