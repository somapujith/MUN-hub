import { and, count, eq, inArray, lt, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  accommodationOptions,
  committees,
  muns,
  paymentWebhookEvents,
  payments,
  portfolios,
  registrationGroups,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { isRecentlyExpired, notifyExpiredCheckouts } from '@/lib/jobs/release-expired-holds'
import type { PaymentOrder } from '@/lib/payments/adapter'
import { onRegistrationConfirmed, runPaymentHook } from '@/lib/payments/events'
import { computeFeeBreakdownAdditive, type FeeBreakdownAdditive } from '@/lib/payments/fees-additive'
import { getPlatformFeeRates } from '@/lib/payments/fees'
import { effectivePassPrice } from '@/lib/payments/pricing'
import { getPaymentsAdapter } from '@/lib/payments/registry'
import { runInBackground } from '@/lib/runtime-background'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { RegistrationInput, RegistrationStatus } from '@/lib/types'

const RESERVATION_TTL_MS = 15 * 60 * 1000

/**
 * The real, browser-facing MUN Hub page a redirect-based provider's
 * `return_url` should send the student's browser to after paying (Cashfree's
 * `order_meta.return_url` — this must never be the webhook endpoint, which is
 * a completely separate, server-to-server concept). The pay page itself never
 * trusts this redirect to mean anything: it polls `GET /registrations/:id` to
 * learn the real outcome (register-pay-page.tsx).
 */
function buildPaymentReturnUrl(munSlug: string, registrationId: string): string {
  const webOrigin = (getRuntimeEnv('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '')
  return `${webOrigin}/register/${encodeURIComponent(munSlug)}/pay?registrationId=${encodeURIComponent(registrationId)}`
}

/**
 * The paying user's details for a provider whose order-creation API requires
 * `customer_details` (Cashfree; see CreateOrderInput.customer's doc comment
 * in lib/payments/adapter.ts). `phone` is non-null in real traffic — the
 * route layer (server/routes/registrations.ts) already gates on
 * `isProfileComplete` before this is ever reached — but this function stays
 * defensive since initiateRegistration itself is deliberately untested-for-
 * profile-completeness and callable directly (e.g. in unit tests, always
 * against the mock adapter, which ignores this field entirely).
 */
async function loadCustomerDetails(userId: string): Promise<{ id: string; name: string; email: string; phone: string } | undefined> {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user ? { id: user.id, name: user.name, email: user.email, phone: user.phone ?? '' } : undefined
}

/**
 * Every status that holds a seat: the two in-flight holds, a confirmed
 * registration, and the two attendance outcomes a confirmed registration
 * turns into (`ATTENDED` at door check-in, `NO_SHOW` from the roster).
 *
 * ATTENDED/NO_SHOW are counted here on purpose. Door check-in opens 24h
 * before the conference and is allowed while the MUN is still
 * REGISTRATION_OPEN (lib/actions/check-in.ts), so a delegate checked in
 * early used to stop counting toward their pass, committee, portfolio and
 * accommodation capacity — and toward the "you already have an active
 * registration" check — while registration was still taking money. Their
 * portfolio could then be sold to someone else, and they could buy the same
 * pass twice. MUN Hub has no refunds, so neither is recoverable.
 *
 * Matches lib/actions/admin-muns.ts's `SEATED_STATUSES` and
 * lib/actions/organizer-communications.ts's `MESSAGEABLE_STATUSES` for the
 * post-confirmation half. CANCELLED/REFUNDED are excluded so a released or
 * refunded seat frees capacity immediately.
 */
export const ACTIVE_REGISTRATION_STATUSES: RegistrationStatus[] = [
  'PENDING',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'ATTENDED',
  'NO_SHOW',
]
const RELEASABLE_STATUSES: RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING']

/** Group/delegation registration — reserved team size range (spec: 2 to a sane max). */
export const GROUP_MIN_SIZE = 2
export const GROUP_MAX_SIZE = 20

/**
 * Lazy seat-hold sweep: cancels the PENDING/PAYMENT_PENDING registrations in
 * `scope` whose reservation window has expired, freeing their seats, and
 * returns how many it released. The releasing UPDATE re-checks status and
 * expiry, so a hold confirmed or released concurrently is left alone (and
 * never emailed twice).
 *
 * Released checkout holds (PAYMENT_PENDING — the delegate had reached
 * payment) that expired within the last hour get the seat-hold-expired email
 * after the UPDATE commits, in the background, the same rule as the
 * release-expired-holds cron job (lib/jobs/release-expired-holds.ts), which
 * sweeps every product every five minutes.
 */
async function sweepExpiredHolds(scope: SQL): Promise<number> {
  const now = new Date()
  const releasable = and(scope, inArray(registrations.status, RELEASABLE_STATUSES), lt(registrations.expiresAt, now))

  // One read in the common case (nothing expired). The status seen here is
  // what tells a checkout hold from an unpaid one; UPDATE ... RETURNING only
  // sees the new status.
  const expired = await db
    .select({ id: registrations.id, status: registrations.status, expiresAt: registrations.expiresAt })
    .from(registrations)
    .where(releasable)
  if (expired.length === 0) return 0

  const released = await db
    .update(registrations)
    .set({ status: 'CANCELLED', updatedAt: now })
    .where(
      and(
        inArray(
          registrations.id,
          expired.map((row) => row.id),
        ),
        releasable,
      ),
    )
    .returning({ id: registrations.id })

  const releasedIds = new Set(released.map((row) => row.id))
  const toNotify = expired.filter(
    (row) => releasedIds.has(row.id) && row.status === 'PAYMENT_PENDING' && isRecentlyExpired(row.expiresAt, now),
  )
  if (toNotify.length > 0) {
    // notifyExpiredCheckouts logs its own per-registration failures.
    void runInBackground('seat-hold-expired emails', () => notifyExpiredCheckouts(toNotify))
  }

  return released.length
}

/**
 * Releases expired seat holds for `registrationProductId` (see
 * `sweepExpiredHolds`). Called as a lazy sweep at the top of
 * `initiateRegistration`'s capacity check. Returns the number released.
 */
export async function releaseExpiredReservations(registrationProductId: string): Promise<number> {
  return sweepExpiredHolds(eq(registrations.registrationProductId, registrationProductId))
}

async function releaseExpiredReservationsForMun(munId: string): Promise<void> {
  await sweepExpiredHolds(eq(registrations.munId, munId))
}

/**
 * Eligibility failures thrown by `initiateRegistration`. The HTTP layer
 * (server/routes/registrations.ts) maps these to 4xx responses; capacity
 * failures end in "at capacity" and map through the shared error handler.
 */
export const REGISTRATION_ERRORS = {
  notOpen: 'Registration is not open for this MUN',
  notOpenYet: "Registration for this MUN hasn't opened yet",
  deadlinePassed: 'The registration deadline for this MUN has passed',
  passUnavailable: 'This pass is no longer available',
  passDeadlinePassed: 'The deadline for this pass has passed',
  passWrongMun: 'This pass does not belong to this MUN',
  committeeWrongMun: 'This committee does not belong to this MUN',
  portfolioWrongCommittee: 'This portfolio does not belong to the chosen committee',
  portfolioNeedsCommittee: 'Choose a committee before choosing a portfolio',
  portfoliosDisabled: 'This committee does not offer portfolio selection',
  profileIncomplete: 'Complete your profile before registering for a MUN',
  paymentsUnavailable:
    "Online payments aren't available yet, so paid passes can't be booked right now. Please try again later.",
  paymentStartFailed: "We couldn't start your payment, so no seat was held. Please try again.",
  idempotencyKeyReused: 'This request key was already used for a different registration',
  // Group/delegation registration (2026-09-17) — see initiateGroupRegistration below.
  delegationNotAllowed: 'This pass does not support group registration',
  groupSizeInvalid: `Team size must be a whole number from ${GROUP_MIN_SIZE} to ${GROUP_MAX_SIZE}`,
} as const

/** HTTP status for each `REGISTRATION_ERRORS` message. */
export const REGISTRATION_ERROR_STATUS: Record<string, 400 | 409 | 503> = {
  [REGISTRATION_ERRORS.notOpen]: 409,
  [REGISTRATION_ERRORS.notOpenYet]: 409,
  [REGISTRATION_ERRORS.deadlinePassed]: 409,
  [REGISTRATION_ERRORS.passUnavailable]: 409,
  [REGISTRATION_ERRORS.passDeadlinePassed]: 409,
  [REGISTRATION_ERRORS.passWrongMun]: 400,
  [REGISTRATION_ERRORS.committeeWrongMun]: 400,
  [REGISTRATION_ERRORS.portfolioWrongCommittee]: 400,
  [REGISTRATION_ERRORS.portfolioNeedsCommittee]: 400,
  [REGISTRATION_ERRORS.portfoliosDisabled]: 400,
  [REGISTRATION_ERRORS.profileIncomplete]: 409,
  [REGISTRATION_ERRORS.paymentsUnavailable]: 503,
  [REGISTRATION_ERRORS.paymentStartFailed]: 503,
  [REGISTRATION_ERRORS.idempotencyKeyReused]: 409,
  [REGISTRATION_ERRORS.delegationNotAllowed]: 409,
  [REGISTRATION_ERRORS.groupSizeInvalid]: 400,
}

export interface InitiateRegistrationOptions {
  /**
   * Client-supplied Idempotency-Key. A repeat call by the same user with the
   * same key returns the original registration (`replayed: true`) instead
   * of reserving — or rejecting — a second seat.
   */
  idempotencyKey?: string
}

export interface InitiateRegistrationResult {
  registrationId: string
  /** Provider order to pay; null for a free pass (confirmed immediately). */
  orderId: string | null
  status: RegistrationStatus
  /** True when this call returned an earlier registration for the same key. */
  replayed: boolean
}

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

async function findByIdempotencyKey(executor: DbOrTx, userId: string, idempotencyKey: string) {
  const [row] = await executor
    .select({
      id: registrations.id,
      munId: registrations.munId,
      registrationProductId: registrations.registrationProductId,
      status: registrations.status,
      orderId: payments.providerOrderId,
      // Set only for the head delegate's own row from a group/delegation
      // registration — lets a replayed group-start request be told apart
      // from a replayed solo one (see toGroupReplay below).
      registrationGroupId: registrations.registrationGroupId,
    })
    .from(registrations)
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(and(eq(registrations.userId, userId), eq(registrations.idempotencyKey, idempotencyKey)))
    .limit(1)
  return row ?? null
}

type IdempotentMatch = NonNullable<Awaited<ReturnType<typeof findByIdempotencyKey>>>

function toReplay(
  existing: IdempotentMatch,
  input: { munId: string; registrationProductId: string },
): InitiateRegistrationResult {
  // Same key, different request: refuse rather than hand back a
  // registration for something the caller didn't ask for.
  if (existing.munId !== input.munId || existing.registrationProductId !== input.registrationProductId) {
    throw new Error(REGISTRATION_ERRORS.idempotencyKeyReused)
  }
  return { registrationId: existing.id, orderId: existing.orderId, status: existing.status, replayed: true }
}

const IDEMPOTENCY_KEY_CONSTRAINT = 'registrations_user_idempotency_key_uq'

/** postgres-js unique violation on `constraint`, looking through DrizzleQueryError's `cause`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    const pgError = current as { code?: string; constraint_name?: string; cause?: unknown }
    if (pgError.code === '23505' && pgError.constraint_name === constraint) return true
    current = pgError.cause
  }
  return false
}

/**
 * Reserves a seat and starts the payment flow for the authenticated user
 * identified by the caller-supplied `session`.
 *
 * SECURITY (IDOR): the acting user is derived exclusively from `session` —
 * this function does NOT accept a caller-supplied `userId`.
 * `RegistrationInput.userId` is typed optional specifically so it can never
 * be required/trusted from the caller; it is ignored here even if present.
 * A previous draft accepted `userId` as an input field, which let any
 * caller register as an arbitrary user — do not reintroduce that.
 *
 * Throws `Error('Forbidden')` if there is no active session.
 * Throws `Error('Registration product is at capacity')` if full.
 *
 * Throws `REGISTRATION_ERRORS.paymentsUnavailable` for a paid pass when no
 * payments adapter is usable (nothing is reserved).
 *
 * Flow:
 *   0. With an idempotency key: if this user already used it, return that
 *      registration (`replayed: true`) and stop.
 *   1. Release expired reservations for this product (frees stale seats).
 *   2. In a transaction: share-lock the mun and require REGISTRATION_OPEN
 *      within its registration window; lock the pass and require it to be
 *      active, on this mun and before its deadline; lock the chosen
 *      committee/portfolio (if any), require they belong to this mun /
 *      committee, and count their active seats. Every failure throws one of
 *      `REGISTRATION_ERRORS` or an "... at capacity" error. Then
 *      count PENDING+PAYMENT_PENDING+CONFIRMED registrations
 *      against the product's capacity; if full, abort. The price is decided
 *      here too (early-bird if still running, plus accommodation) along
 *      with its platform-fee split. A free total is CONFIRMED on the spot;
 *      otherwise create a PENDING registration with a 15-minute expiresAt.
 *   3. After that transaction commits, call the payments adapter's
 *      createOrder() (external call — deliberately outside the DB
 *      transaction). If it fails, the seat is released straight away.
 *   4. In a second transaction, flip the registration to PAYMENT_PENDING and
 *      create the corresponding payment row (amount, currency, fee split).
 */
export async function initiateRegistration(
  input: Omit<RegistrationInput, 'userId'>,
  session: Session | null,
  options: InitiateRegistrationOptions = {},
): Promise<InitiateRegistrationResult> {
  if (!session) {
    throw new Error('Forbidden')
  }
  const userId = session.userId
  const idempotencyKey = options.idempotencyKey || undefined

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(db, userId, idempotencyKey)
    if (existing) return toReplay(existing, input)
  }

  try {
    return await reserveAndStartPayment(input, userId, idempotencyKey)
  } catch (error) {
    // Two concurrent calls with the same key that didn't serialize on the
    // same pass lock: the loser trips the unique index and gets the winner.
    if (idempotencyKey && isUniqueViolation(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
      const existing = await findByIdempotencyKey(db, userId, idempotencyKey)
      if (existing) return toReplay(existing, input)
    }
    throw error
  }
}

async function reserveAndStartPayment(
  input: Omit<RegistrationInput, 'userId'>,
  userId: string,
  idempotencyKey: string | undefined,
): Promise<InitiateRegistrationResult> {
  const adapter = getPaymentsAdapter()

  if (input.portfolioId && !input.committeeId) {
    throw new Error(REGISTRATION_ERRORS.portfolioNeedsCommittee)
  }

  await releaseExpiredReservations(input.registrationProductId)
  // Committee/portfolio/accommodation counts span every pass on the mun, so
  // stale holds on the mun's other passes must be released too.
  await releaseExpiredReservationsForMun(input.munId)

  const reservation = await db.transaction(async (tx) => {
    // Share-lock the mun so an organizer/admin status change (transitionMun
    // takes FOR UPDATE) cannot close registration between this check and the
    // insert below. Shared locks don't block other registrations.
    const [mun] = await tx
      .select({
        id: muns.id,
        slug: muns.slug,
        status: muns.status,
        registrationOpensAt: muns.registrationOpensAt,
        registrationDeadline: muns.registrationDeadline,
      })
      .from(muns)
      .where(eq(muns.id, input.munId))
      .for('share')
      .limit(1)

    if (!mun) {
      throw new Error('Mun not found')
    }
    const now = new Date()
    if (mun.status !== 'REGISTRATION_OPEN') {
      throw new Error(REGISTRATION_ERRORS.notOpen)
    }
    if (mun.registrationOpensAt && mun.registrationOpensAt > now) {
      throw new Error(REGISTRATION_ERRORS.notOpenYet)
    }
    if (mun.registrationDeadline && mun.registrationDeadline < now) {
      throw new Error(REGISTRATION_ERRORS.deadlinePassed)
    }

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
    if (product.munId !== input.munId) {
      throw new Error(REGISTRATION_ERRORS.passWrongMun)
    }
    if (product.status !== 'active') {
      throw new Error(REGISTRATION_ERRORS.passUnavailable)
    }
    if (product.deadline && product.deadline < now) {
      throw new Error(REGISTRATION_ERRORS.passDeadlinePassed)
    }

    // A concurrent retry with the same key blocked on the pass lock above
    // until the first call committed — it must get that registration back,
    // not a "you already have an active registration" error.
    if (idempotencyKey) {
      const existing = await findByIdempotencyKey(tx, userId, idempotencyKey)
      if (existing) return { kind: 'replay' as const, existing }
    }

    const activeRegistrations = await tx
      .select({ id: registrations.id, userId: registrations.userId })
      .from(registrations)
      .where(
        and(
          eq(registrations.registrationProductId, input.registrationProductId),
          inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
        ),
      )

    // The product row-lock above serializes every concurrent
    // initiateRegistration call for this product through this transaction,
    // so this check is race-free the same way the capacity check below is —
    // two simultaneous calls from the same user cannot both pass it.
    if (activeRegistrations.some((r) => r.userId === userId)) {
      throw new Error('You already have an active registration for this product')
    }

    if (activeRegistrations.length >= product.capacity) {
      throw new Error('Registration product is at capacity')
    }

    // Committee selection is optional. When given, the committee must belong
    // to this mun and its capacity gets the same row-lock treatment as the
    // pass above: every concurrent registration into this committee (across
    // all passes) serializes on this lock before counting.
    if (input.committeeId) {
      const [committee] = await tx
        .select({
          id: committees.id,
          munId: committees.munId,
          capacity: committees.capacity,
          portfoliosEnabled: committees.portfoliosEnabled,
        })
        .from(committees)
        .where(eq(committees.id, input.committeeId))
        .for('update')
        .limit(1)

      if (!committee) {
        throw new Error('Committee not found')
      }
      if (committee.munId !== input.munId) {
        throw new Error(REGISTRATION_ERRORS.committeeWrongMun)
      }

      const [{ taken: committeeTaken }] = await tx
        .select({ taken: count() })
        .from(registrations)
        .where(
          and(
            eq(registrations.committeeId, committee.id),
            inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
          ),
        )
      if (committeeTaken >= committee.capacity) {
        throw new Error('Committee is at capacity')
      }

      // `portfolios.availability` is the number of delegates a portfolio can
      // seat (1 = a single delegate; the organizer can raise it for double
      // delegations). Locked for the same reason as the committee.
      if (input.portfolioId) {
        const [portfolio] = await tx
          .select({
            id: portfolios.id,
            committeeId: portfolios.committeeId,
            availability: portfolios.availability,
          })
          .from(portfolios)
          .where(eq(portfolios.id, input.portfolioId))
          .for('update')
          .limit(1)

        if (!portfolio) {
          throw new Error('Portfolio not found')
        }
        if (portfolio.committeeId !== committee.id) {
          throw new Error(REGISTRATION_ERRORS.portfolioWrongCommittee)
        }
        if (!committee.portfoliosEnabled) {
          throw new Error(REGISTRATION_ERRORS.portfoliosDisabled)
        }

        const [{ taken: portfolioTaken }] = await tx
          .select({ taken: count() })
          .from(registrations)
          .where(
            and(
              eq(registrations.portfolioId, portfolio.id),
              inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
            ),
          )
        if (portfolioTaken >= portfolio.availability) {
          throw new Error('Portfolio is at capacity')
        }
      }
    }

    // Accommodation is optional. When selected, its capacity gets the exact
    // same row-lock protection as the registration product above — a room
    // type selling out is the same overbooking risk, in the same
    // transaction so both checks serialize together.
    let accommodationPrice = 0
    if (input.accommodationOptionId) {
      const [option] = await tx
        .select()
        .from(accommodationOptions)
        .where(eq(accommodationOptions.id, input.accommodationOptionId))
        .for('update')
        .limit(1)

      if (!option) {
        throw new Error('Accommodation option not found')
      }
      if (option.munId !== input.munId) {
        throw new Error('Accommodation option does not belong to this mun')
      }
      if (option.status !== 'active') {
        throw new Error('Accommodation option is not available')
      }

      const activeAccommodationSelections = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(
          and(
            eq(registrations.accommodationOptionId, input.accommodationOptionId),
            inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
          ),
        )

      if (activeAccommodationSelections.length >= option.capacity) {
        throw new Error('Accommodation option is at capacity')
      }

      accommodationPrice = option.price
    }

    // Price decided here, under the pass lock, from the server's clock —
    // never from anything the client displayed.
    const total = effectivePassPrice(product, now).price + accommodationPrice
    const free = total === 0

    // Checked before anything is inserted, so an unpayable request holds no
    // seat. Fee rates are parsed here for the same reason: a malformed
    // PLATFORM_FEE_BPS fails the request before a seat is reserved.
    //
    // Additive fee model (docs/payments/SPEC.md §4.4): the delegate pays
    // `total` (the listed price) PLUS the platform fee PLUS GST on the fee;
    // the organizer is owed `total` exactly, unchanged. `fees.totalCharge` —
    // not `total` — is what's actually charged and stored as payments.amount.
    let fees: FeeBreakdownAdditive | null = null
    if (!free) {
      if (!adapter) {
        throw new Error(REGISTRATION_ERRORS.paymentsUnavailable)
      }
      fees = computeFeeBreakdownAdditive(total, getPlatformFeeRates())
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
        accommodationOptionId: input.accommodationOptionId,
        accommodationAnswers: input.accommodationAnswers,
        // A free pass has nothing to pay: confirmed now, no hold, no order.
        status: free ? 'CONFIRMED' : 'PENDING',
        expiresAt: free ? null : new Date(Date.now() + RESERVATION_TTL_MS),
        idempotencyKey,
      })
      .returning({ id: registrations.id, status: registrations.status })

    return { kind: 'created' as const, registration: created, total, currency: product.currency, fees, munSlug: mun.slug }
  })

  if (reservation.kind === 'replay') {
    return toReplay(reservation.existing, input)
  }

  const { registration, total, currency, fees, munSlug } = reservation

  if (!fees || !adapter) {
    // Awaited (it never rejects): the hook sends the confirmation email, and
    // on Workers un-awaited work can be dropped once the response is sent.
    await runPaymentHook(onRegistrationConfirmed, registration.id)
    return { registrationId: registration.id, orderId: null, status: registration.status, replayed: false }
  }

  let order: PaymentOrder
  try {
    order = await adapter.createOrder({
      amount: fees.totalCharge,
      currency,
      registrationId: registration.id,
      returnUrl: buildPaymentReturnUrl(munSlug, registration.id),
      customer: await loadCustomerDetails(userId),
    })
  } catch (error) {
    // Don't make the delegate wait out a 15-minute hold on a seat that can't
    // be paid for. Clearing the key lets the client retry with the same one.
    console.error(`[payments] createOrder failed for registration ${registration.id}`, error)
    await db
      .update(registrations)
      .set({ status: 'CANCELLED', idempotencyKey: null, updatedAt: new Date() })
      .where(and(eq(registrations.id, registration.id), eq(registrations.status, 'PENDING')))
    throw new Error(REGISTRATION_ERRORS.paymentStartFailed)
  }

  await db.transaction(async (tx) => {
    await tx
      .update(registrations)
      .set({ status: 'PAYMENT_PENDING', updatedAt: new Date() })
      .where(and(eq(registrations.id, registration.id), eq(registrations.status, 'PENDING')))

    await tx.insert(payments).values({
      registrationId: registration.id,
      provider: adapter.provider,
      providerOrderId: order.orderId,
      // Stored once, at order creation, never regenerated on a later read —
      // see the checkoutUrl/checkoutSessionId columns' own doc comments in
      // lib/db/schema.ts.
      checkoutUrl: order.checkoutUrl ?? null,
      checkoutSessionId: order.checkoutSessionId ?? null,
      amount: fees.totalCharge,
      currency,
      platformFeeAmount: fees.platformFee,
      platformFeeTaxAmount: fees.platformFeeTax,
      // Additive model: the organizer is owed the full listed price, always,
      // never derived by subtracting anything from the total charged.
      organizerNetAmount: fees.passAmount,
      status: 'PENDING',
    })
  })

  return { registrationId: registration.id, orderId: order.orderId, status: 'PAYMENT_PENDING', replayed: false }
}

// ---------------------------------------------------------------------------
// Group/delegation registration (2026-09-17). A head delegate reserves and
// pays for `teamSize` seats in one order instead of each teammate paying
// individually — gated on `registrationProducts.allowsDelegation`. Full
// design: docs/autonomous-run/changes/lane-delegation.md.
//
// Reuses the exact same locking discipline as `reserveAndStartPayment`
// above (share-lock the mun, row-lock the product) — this is deliberately
// NOT a second, incompatible capacity check. The only difference is that N
// seats are counted/reserved atomically instead of 1.
//
// Shape: one `registrations` row per team member, all sharing one
// `registration_groups` row. The head's own row is created and filled in
// immediately (status mirrors the solo flow); the other `teamSize - 1` rows
// are created as placeholders — temporarily owned by the head
// (`userId = headUserId`) until a teammate accepts an emailed invitation
// and the row is reassigned to them (lib/actions/registration-group.ts).
// This holds their seats for real (they count toward
// ACTIVE_REGISTRATION_STATUSES like any other row) without requiring
// `registrations.userId` to become nullable — a change with a much bigger
// blast radius across the rest of the codebase.
//
// Committee/portfolio selection and accommodation are intentionally not
// offered in the group flow (scope decision — see the design doc):
// portfolios are individual (one delegate each) and don't map cleanly onto
// "N delegates, not yet named", and accommodation adds another per-member
// dimension the head can't answer on a teammate's behalf. An organizer can
// still assign committees/portfolios to individual members afterwards via
// the roster the same way they always could.
// ---------------------------------------------------------------------------

export interface GroupRegistrationInput {
  munId: string
  registrationProductId: string
  /** Whole team size, GROUP_MIN_SIZE..GROUP_MAX_SIZE, including the head delegate. */
  teamSize: number
  /** The head delegate's own answers to the mun's registration-form fields. */
  formResponses?: Record<string, unknown>
}

export interface InitiateGroupRegistrationResult {
  groupId: string
  /** The head delegate's own registration id — this is what gets paid for at `/register/:slug/pay`. */
  headRegistrationId: string
  orderId: string | null
  status: RegistrationStatus
  replayed: boolean
}

function toGroupReplay(existing: IdempotentMatch): InitiateGroupRegistrationResult {
  if (!existing.registrationGroupId) {
    // The same idempotency key was already used for a *solo* registration —
    // never silently reinterpret it as a group one.
    throw new Error(REGISTRATION_ERRORS.idempotencyKeyReused)
  }
  return {
    groupId: existing.registrationGroupId,
    headRegistrationId: existing.id,
    orderId: existing.orderId,
    status: existing.status,
    replayed: true,
  }
}

/**
 * Group/delegation counterpart to `initiateRegistration`. Same IDOR
 * guarantee: the head delegate is derived exclusively from `session`.
 *
 * Throws `Error('Forbidden')` with no session, `REGISTRATION_ERRORS.groupSizeInvalid`
 * for a `teamSize` outside GROUP_MIN_SIZE..GROUP_MAX_SIZE,
 * `REGISTRATION_ERRORS.delegationNotAllowed` when the pass doesn't have
 * `allowsDelegation` set, and `Error('Registration product is at capacity')`
 * when fewer than `teamSize` seats remain (mapped to 409 CONFLICT_CAPACITY
 * by the same global error handler solo registration uses).
 */
export async function initiateGroupRegistration(
  input: GroupRegistrationInput,
  session: Session | null,
  options: InitiateRegistrationOptions = {},
): Promise<InitiateGroupRegistrationResult> {
  if (!session) {
    throw new Error('Forbidden')
  }
  const userId = session.userId
  const idempotencyKey = options.idempotencyKey || undefined

  if (!Number.isInteger(input.teamSize) || input.teamSize < GROUP_MIN_SIZE || input.teamSize > GROUP_MAX_SIZE) {
    throw new Error(REGISTRATION_ERRORS.groupSizeInvalid)
  }

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(db, userId, idempotencyKey)
    if (existing) return toGroupReplay(existing)
  }

  try {
    return await reserveGroupAndStartPayment(input, userId, idempotencyKey)
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
      const existing = await findByIdempotencyKey(db, userId, idempotencyKey)
      if (existing) return toGroupReplay(existing)
    }
    throw error
  }
}

async function reserveGroupAndStartPayment(
  input: GroupRegistrationInput,
  userId: string,
  idempotencyKey: string | undefined,
): Promise<InitiateGroupRegistrationResult> {
  const adapter = getPaymentsAdapter()

  await releaseExpiredReservations(input.registrationProductId)

  const reservation = await db.transaction(async (tx) => {
    const [mun] = await tx
      .select({
        id: muns.id,
        slug: muns.slug,
        status: muns.status,
        registrationOpensAt: muns.registrationOpensAt,
        registrationDeadline: muns.registrationDeadline,
      })
      .from(muns)
      .where(eq(muns.id, input.munId))
      .for('share')
      .limit(1)

    if (!mun) {
      throw new Error('Mun not found')
    }
    const now = new Date()
    if (mun.status !== 'REGISTRATION_OPEN') {
      throw new Error(REGISTRATION_ERRORS.notOpen)
    }
    if (mun.registrationOpensAt && mun.registrationOpensAt > now) {
      throw new Error(REGISTRATION_ERRORS.notOpenYet)
    }
    if (mun.registrationDeadline && mun.registrationDeadline < now) {
      throw new Error(REGISTRATION_ERRORS.deadlinePassed)
    }

    // Same row lock as solo registration: every concurrent
    // initiateRegistration/initiateGroupRegistration call for this product
    // serializes here, so a group registration can never oversell a
    // capacity that a simultaneous solo registration (or another group
    // registration) is also counting against.
    const [product] = await tx
      .select()
      .from(registrationProducts)
      .where(eq(registrationProducts.id, input.registrationProductId))
      .for('update')
      .limit(1)

    if (!product) {
      throw new Error('Registration product not found')
    }
    if (product.munId !== input.munId) {
      throw new Error(REGISTRATION_ERRORS.passWrongMun)
    }
    if (product.status !== 'active') {
      throw new Error(REGISTRATION_ERRORS.passUnavailable)
    }
    if (product.deadline && product.deadline < now) {
      throw new Error(REGISTRATION_ERRORS.passDeadlinePassed)
    }
    if (!product.allowsDelegation) {
      throw new Error(REGISTRATION_ERRORS.delegationNotAllowed)
    }

    if (idempotencyKey) {
      const existing = await findByIdempotencyKey(tx, userId, idempotencyKey)
      if (existing) return { kind: 'replay' as const, existing }
    }

    const activeRegistrations = await tx
      .select({ id: registrations.id, userId: registrations.userId })
      .from(registrations)
      .where(
        and(
          eq(registrations.registrationProductId, input.registrationProductId),
          inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
        ),
      )

    if (activeRegistrations.some((r) => r.userId === userId)) {
      throw new Error('You already have an active registration for this product')
    }

    if (activeRegistrations.length + input.teamSize > product.capacity) {
      throw new Error('Registration product is at capacity')
    }

    const total = effectivePassPrice(product, now).price * input.teamSize
    const free = total === 0

    // Additive fee model — see the matching comment in reserveAndStartPayment above.
    let fees: FeeBreakdownAdditive | null = null
    if (!free) {
      if (!adapter) {
        throw new Error(REGISTRATION_ERRORS.paymentsUnavailable)
      }
      fees = computeFeeBreakdownAdditive(total, getPlatformFeeRates())
    }

    const [group] = await tx
      .insert(registrationGroups)
      .values({
        munId: input.munId,
        registrationProductId: input.registrationProductId,
        headUserId: userId,
        teamSize: input.teamSize,
      })
      .returning({ id: registrationGroups.id })

    const expiresAt = free ? null : new Date(Date.now() + RESERVATION_TTL_MS)
    const status: RegistrationStatus = free ? 'CONFIRMED' : 'PENDING'

    const [headRegistration] = await tx
      .insert(registrations)
      .values({
        userId,
        munId: input.munId,
        registrationProductId: input.registrationProductId,
        formResponses: input.formResponses,
        registrationGroupId: group.id,
        status,
        expiresAt,
        idempotencyKey,
      })
      .returning({ id: registrations.id, status: registrations.status })

    // The other teamSize-1 seats: reserved now, unclaimed until a teammate
    // accepts an invitation (lib/actions/registration-group.ts). Temporarily
    // owned by the head — see this section's header comment.
    const placeholderCount = input.teamSize - 1
    if (placeholderCount > 0) {
      await tx.insert(registrations).values(
        Array.from({ length: placeholderCount }, () => ({
          userId,
          munId: input.munId,
          registrationProductId: input.registrationProductId,
          registrationGroupId: group.id,
          status,
          expiresAt,
        })),
      )
    }

    await tx
      .update(registrationGroups)
      .set({ headRegistrationId: headRegistration.id })
      .where(eq(registrationGroups.id, group.id))

    return {
      kind: 'created' as const,
      groupId: group.id,
      headRegistration,
      total,
      currency: product.currency,
      fees,
      munSlug: mun.slug,
    }
  })

  if (reservation.kind === 'replay') {
    return toGroupReplay(reservation.existing)
  }

  const { groupId, headRegistration, total, currency, fees, munSlug } = reservation

  if (!fees || !adapter) {
    await runPaymentHook(onRegistrationConfirmed, headRegistration.id)
    return {
      groupId,
      headRegistrationId: headRegistration.id,
      orderId: null,
      status: headRegistration.status,
      replayed: false,
    }
  }

  let order: PaymentOrder
  try {
    order = await adapter.createOrder({
      amount: fees.totalCharge,
      currency,
      registrationId: headRegistration.id,
      returnUrl: buildPaymentReturnUrl(munSlug, headRegistration.id),
      customer: await loadCustomerDetails(userId),
    })
  } catch (error) {
    console.error(`[payments] createOrder failed for group ${groupId} (head registration ${headRegistration.id})`, error)
    // Release every seat in the group together — a group hold is all-or-nothing.
    await db
      .update(registrations)
      .set({ status: 'CANCELLED', idempotencyKey: null, updatedAt: new Date() })
      .where(and(eq(registrations.registrationGroupId, groupId), eq(registrations.status, 'PENDING')))
    throw new Error(REGISTRATION_ERRORS.paymentStartFailed)
  }

  await db.transaction(async (tx) => {
    // One statement flips every seat in the group (head + placeholders) from
    // PENDING to PAYMENT_PENDING together — they share one payment.
    await tx
      .update(registrations)
      .set({ status: 'PAYMENT_PENDING', updatedAt: new Date() })
      .where(and(eq(registrations.registrationGroupId, groupId), eq(registrations.status, 'PENDING')))

    const [payment] = await tx
      .insert(payments)
      .values({
        registrationId: headRegistration.id,
        provider: adapter.provider,
        providerOrderId: order.orderId,
        checkoutUrl: order.checkoutUrl ?? null,
        checkoutSessionId: order.checkoutSessionId ?? null,
        amount: fees.totalCharge,
        currency,
        platformFeeAmount: fees.platformFee,
        platformFeeTaxAmount: fees.platformFeeTax,
        organizerNetAmount: fees.passAmount,
        status: 'PENDING',
      })
      .returning({ id: payments.id })

    await tx.update(registrationGroups).set({ paymentId: payment.id }).where(eq(registrationGroups.id, groupId))
  })

  return {
    groupId,
    headRegistrationId: headRegistration.id,
    orderId: order.orderId,
    status: 'PAYMENT_PENDING',
    replayed: false,
  }
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
export async function getRegistrationById(
  registrationId: string,
  session: Session | null,
): Promise<RegistrationWithDetails | null> {
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

export interface RegistrationReceipt {
  registrationId: string
  status: RegistrationStatus
  registeredAt: Date
  mun: {
    name: string
    slug: string
    city: string | null
    country: string | null
    startDate: Date | null
    endDate: Date | null
  }
  passName: string
  committeeName: string | null
  portfolioName: string | null
  /** Null for a free pass (nothing was paid). */
  payment: {
    amount: number
    currency: string
    status: (typeof payments.$inferSelect)['status']
    /** Provider's payment id once captured, else null. */
    reference: string | null
    orderId: string
    /** When the capture was applied; null until paid. */
    paidAt: Date | null
  } | null
}

/**
 * The delegate's own receipt for one registration. Owner-only — unlike
 * `getRegistrationById`, organizers and admins get null here (they have
 * their own views), so the route can answer 404 without revealing whether
 * the id exists. Never returns the fee split or any exception detail.
 */
export async function getRegistrationReceipt(
  registrationId: string,
  session: Session | null,
): Promise<RegistrationReceipt | null> {
  if (!session) {
    throw new Error('Forbidden')
  }

  const row = await db.query.registrations.findFirst({
    where: and(eq(registrations.id, registrationId), eq(registrations.userId, session.userId)),
    columns: { id: true, status: true, createdAt: true },
    with: {
      mun: { columns: { name: true, slug: true, city: true, country: true, startDate: true, endDate: true } },
      registrationProduct: { columns: { name: true } },
      committee: { columns: { name: true } },
      portfolio: { columns: { name: true } },
      payment: {
        columns: {
          amount: true,
          currency: true,
          status: true,
          providerPaymentId: true,
          providerOrderId: true,
          provider: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!row) return null

  const payment = row.payment.at(0) ?? null
  let paidAt: Date | null = null
  if (payment?.status === 'PAID') {
    // The moment the capture was applied, from the webhook log; payments
    // processed before that log existed fall back to the row's last update.
    const [event] = await db
      .select({ processedAt: paymentWebhookEvents.processedAt })
      .from(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.provider, payment.provider),
          eq(paymentWebhookEvents.providerOrderId, payment.providerOrderId),
          eq(paymentWebhookEvents.outcome, 'CONFIRMED'),
        ),
      )
      .limit(1)
    paidAt = event?.processedAt ?? payment.updatedAt
  }

  return {
    registrationId: row.id,
    status: row.status,
    registeredAt: row.createdAt,
    mun: row.mun,
    passName: row.registrationProduct.name,
    committeeName: row.committee?.name ?? null,
    portfolioName: row.portfolio?.name ?? null,
    payment: payment
      ? {
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          reference: payment.providerPaymentId,
          orderId: payment.providerOrderId,
          paidAt,
        }
      : null,
  }
}

/**
 * Public read (no auth) — used by the registration picker UI to show live
 * seat counts. Deliberately excludes CANCELLED/REFUNDED from `taken` so a
 * released or refunded seat frees capacity immediately.
 */
export async function getProductAvailability(
  registrationProductId: string,
): Promise<{ capacity: number; taken: number; available: number }> {
  const [result] = await getProductsAvailability([registrationProductId])
  if (!result) {
    throw new Error('Registration product not found')
  }
  return result[1]
}

/**
 * Batched form of `getProductAvailability` — one release sweep
 * (`sweepExpiredHolds`: a read, plus an UPDATE only when something expired)
 * and one grouped count query across all `registrationProductIds`, instead
 * of 3 round trips per product. A MUN detail page with N passes previously
 * made ~3N sequential DB calls to render availability; this makes 3 or 4
 * calls total regardless of N.
 */
export async function getProductsAvailability(
  registrationProductIds: string[],
): Promise<Array<[string, { capacity: number; taken: number; available: number }]>> {
  if (registrationProductIds.length === 0) {
    return []
  }

  await sweepExpiredHolds(inArray(registrations.registrationProductId, registrationProductIds))

  const products = await db
    .select({ id: registrationProducts.id, capacity: registrationProducts.capacity })
    .from(registrationProducts)
    .where(inArray(registrationProducts.id, registrationProductIds))

  const takenRows = await db
    .select({ productId: registrations.registrationProductId, taken: count() })
    .from(registrations)
    .where(
      and(
        inArray(registrations.registrationProductId, registrationProductIds),
        inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
      ),
    )
    .groupBy(registrations.registrationProductId)

  const takenByProduct = new Map(takenRows.map((row) => [row.productId, row.taken]))

  return products.map((product) => {
    const taken = takenByProduct.get(product.id) ?? 0
    return [product.id, { capacity: product.capacity, taken, available: Math.max(product.capacity - taken, 0) }]
  })
}
