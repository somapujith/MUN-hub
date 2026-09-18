import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  accommodationOptions,
  committees,
  muns,
  payments,
  portfolios,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mockPaymentsAdapter, simulatePaymentOutcome } from '@/lib/payments/mock-adapter'
import { processPaymentWebhook } from '@/lib/payments/webhook'

import {
  REGISTRATION_ERRORS,
  REGISTRATION_ERROR_STATUS,
  initiateRegistration,
  releaseExpiredReservations,
  getRegistrationById,
  getRegistrationReceipt,
  getProductAvailability,
  getProductsAvailability,
} from './registration'

async function createUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' = 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email: `user-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

async function createMun(organizerId: string, overrides: Partial<typeof muns.$inferInsert> = {}) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Reg Mun',
      slug: `reg-mun-${Date.now()}-${Math.random()}`,
      status: 'REGISTRATION_OPEN',
      ...overrides,
    })
    .returning()
  return mun
}

async function createCommittee(munId: string, capacity: number, overrides: Partial<typeof committees.$inferInsert> = {}) {
  const [committee] = await db
    .insert(committees)
    .values({ munId, name: 'Security Council', capacity, ...overrides })
    .returning()
  return committee
}

async function createPortfolio(committeeId: string, availability = 1) {
  const [portfolio] = await db
    .insert(portfolios)
    .values({ committeeId, name: 'France', availability })
    .returning()
  return portfolio
}

const studentSessionFor = (userId: string) => ({ userId, role: 'STUDENT' as const })

async function createProduct(munId: string, capacity: number) {
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId, name: 'Delegate', price: 2500, capacity })
    .returning()
  return product
}

async function createAccommodation(munId: string, capacity: number, price = 1500) {
  const [option] = await db
    .insert(accommodationOptions)
    .values({ munId, name: 'Twin Room', price, capacity })
    .returning()
  return option
}

describe('initiateRegistration', () => {

  it('creates a PENDING->PAYMENT_PENDING registration and a payment order when capacity available', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)


    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' })

    expect(result.registrationId).toBeTruthy()
    expect(result.orderId).toMatch(/^mock_order_/)

    const [registration] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, result.registrationId))
      .limit(1)

    expect(registration?.status).toBe('PAYMENT_PENDING')
    expect(registration?.userId).toBe(student.id)
  })

  it('rejects registration when capacity is full', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const otherStudent = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 1)

    await db.insert(registrations).values({
      userId: otherStudent.id,
      munId: mun.id,
      registrationProductId: product.id,
      status: 'CONFIRMED',
    })


    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('Registration product is at capacity')
  })

  it('releases expired reservations before counting capacity, freeing a slot', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const expiredHolder = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 1)

    await db.insert(registrations).values({
      userId: expiredHolder.id,
      munId: mun.id,
      registrationProductId: product.id,
      status: 'PAYMENT_PENDING',
      expiresAt: new Date(Date.now() - 60_000),
    })


    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' })
    expect(result.registrationId).toBeTruthy()

    const [expired] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.userId, expiredHolder.id))
      .limit(1)
    expect(expired?.status).toBe('CANCELLED')
  })

  it('never oversells capacity under concurrent registrations for the same product', async () => {
    const organizer = await createUser('ORGANIZER')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 3)

    const students = await Promise.all(Array.from({ length: 10 }, () => createUser('STUDENT')))

    // Each concurrent caller must be a DISTINCT user — since initiateRegistration
    // also rejects a second active registration from the same user, reusing
    // one session across all 10 calls would make most of them fail with "already
    // have an active registration" instead of exercising the capacity race.
    const results = await Promise.allSettled(
      students.map((student) =>
        initiateRegistration(
          { munId: mun.id, registrationProductId: product.id },
          { userId: student.id, role: 'STUDENT' },
        ),
      ),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected')

    expect(succeeded.length).toBe(3)
    expect(failed.length).toBe(7)
    for (const failure of failed as PromiseRejectedResult[]) {
      expect(String(failure.reason)).toMatch(/at capacity/)
    }

    const activeCount = await db
      .select()
      .from(registrations)
      .where(eq(registrations.registrationProductId, product.id))
    const active = activeCount.filter((r) => r.status === 'PENDING' || r.status === 'PAYMENT_PENDING' || r.status === 'CONFIRMED')
    expect(active.length).toBe(3)
  })

  it('rejects a second active registration from the same user for the same product', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)


    const first = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' })
    expect(first.registrationId).toBeTruthy()

    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' }),
    ).rejects.toThrow('You already have an active registration for this product')
  })

  // A delegate checked in at the door (ATTENDED) or marked absent (NO_SHOW)
  // still holds their seat. Door check-in opens 24h before the conference and
  // is allowed while registration is still open, so counting only
  // PENDING/PAYMENT_PENDING/CONFIRMED used to free the seat, let the portfolio
  // be resold and let the same delegate buy the pass a second time.
  for (const seatedStatus of ['ATTENDED', 'NO_SHOW'] as const) {
    it(`keeps a ${seatedStatus} registration counted against pass capacity`, async () => {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const other = await createUser('STUDENT')
      const mun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 1)

      const first = await initiateRegistration(
        { munId: mun.id, registrationProductId: product.id },
        { userId: student.id, role: 'STUDENT' },
      )
      await db.update(registrations).set({ status: seatedStatus }).where(eq(registrations.id, first.registrationId))

      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: other.id, role: 'STUDENT' }),
      ).rejects.toThrow('Registration product is at capacity')

      expect(await getProductAvailability(product.id)).toEqual({ capacity: 1, taken: 1, available: 0 })
    })

    it(`keeps a ${seatedStatus} delegate's portfolio taken and blocks them buying the pass again`, async () => {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const other = await createUser('STUDENT')
      const mun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 10)
      const committee = await createCommittee(mun.id, 10, { portfoliosEnabled: true })
      const portfolio = await createPortfolio(committee.id, 1)

      const first = await initiateRegistration(
        {
          munId: mun.id,
          registrationProductId: product.id,
          committeeId: committee.id,
          portfolioId: portfolio.id,
        },
        { userId: student.id, role: 'STUDENT' },
      )
      await db.update(registrations).set({ status: seatedStatus }).where(eq(registrations.id, first.registrationId))

      await expect(
        initiateRegistration(
          {
            munId: mun.id,
            registrationProductId: product.id,
            committeeId: committee.id,
            portfolioId: portfolio.id,
          },
          { userId: other.id, role: 'STUDENT' },
        ),
      ).rejects.toThrow('Portfolio is at capacity')

      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' }),
      ).rejects.toThrow('You already have an active registration for this product')
    })
  }

  it('allows a fresh registration after the previous one was cancelled (retry after failed payment)', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)


    const first = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' })

    await db
      .update(registrations)
      .set({ status: 'CANCELLED' })
      .where(eq(registrations.id, first.registrationId))

    const second = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, { userId: student.id, role: 'STUDENT' })
    expect(second.registrationId).toBeTruthy()
    expect(second.registrationId).not.toBe(first.registrationId)
  })

  describe('accommodation', () => {
    it('accepts an optional accommodation selection and includes its price in the payment order', async () => {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const mun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 10)
      const accommodation = await createAccommodation(mun.id, 10, 1500)


      const result = await initiateRegistration({
        munId: mun.id,
        registrationProductId: product.id,
        accommodationOptionId: accommodation.id,
        accommodationAnswers: { arrivalDate: '2027-03-09' },
      }, { userId: student.id, role: 'STUDENT' })

      const [registration] = await db.select().from(registrations).where(eq(registrations.id, result.registrationId))
      expect(registration?.accommodationOptionId).toBe(accommodation.id)
      expect(registration?.accommodationAnswers).toEqual({ arrivalDate: '2027-03-09' })

      const [payment] = await db.select().from(payments).where(eq(payments.registrationId, result.registrationId))
      expect(payment?.amount).toBe(product.price + accommodation.price) // 2500 + 1500 = 4000
    })

    it('never oversells accommodation capacity under concurrent registrations for the same option', async () => {
      const organizer = await createUser('ORGANIZER')
      const mun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 100)
      const accommodation = await createAccommodation(mun.id, 2)

      const students = await Promise.all(Array.from({ length: 6 }, () => createUser('STUDENT')))

      const results = await Promise.allSettled(
        students.map((student) =>
          initiateRegistration(
            {
              munId: mun.id,
              registrationProductId: product.id,
              accommodationOptionId: accommodation.id,
            },
            { userId: student.id, role: 'STUDENT' },
          ),
        ),
      )

      const succeeded = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r) => r.status === 'rejected')
      expect(succeeded.length).toBe(2)
      expect(failed.length).toBe(4)
      for (const failure of failed as PromiseRejectedResult[]) {
        expect(String(failure.reason)).toMatch(/[Aa]ccommodation.*at capacity/)
      }

      const activeAccommodationRegs = await db
        .select()
        .from(registrations)
        .where(eq(registrations.accommodationOptionId, accommodation.id))
      const active = activeAccommodationRegs.filter((r) => r.status === 'PENDING' || r.status === 'PAYMENT_PENDING' || r.status === 'CONFIRMED')
      expect(active.length).toBe(2)
    })

    it('rejects an accommodation option that belongs to a different mun', async () => {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const mun = await createMun(organizer.id)
      const otherMun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 10)
      const accommodation = await createAccommodation(otherMun.id, 10)


      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id, accommodationOptionId: accommodation.id }, { userId: student.id, role: 'STUDENT' }),
      ).rejects.toThrow('does not belong to this mun')
    })

    it('rejects an inactive (soft-deleted) accommodation option', async () => {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const mun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 10)
      const accommodation = await createAccommodation(mun.id, 10)
      await db.update(accommodationOptions).set({ status: 'inactive' }).where(eq(accommodationOptions.id, accommodation.id))


      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id, accommodationOptionId: accommodation.id }, { userId: student.id, role: 'STUDENT' }),
      ).rejects.toThrow('not available')
    })
  })

  describe('eligibility', () => {
    async function setup(munOverrides: Partial<typeof muns.$inferInsert> = {}) {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const mun = await createMun(organizer.id, munOverrides)
      const product = await createProduct(mun.id, 10)
      return { organizer, student, mun, product, session: studentSessionFor(student.id) }
    }

    it.each(['DRAFT', 'PUBLISHED', 'VERIFIED', 'REGISTRATION_CLOSED', 'CANCELLED'] as const)(
      'rejects a mun in status %s',
      async (status) => {
        const { mun, product, session } = await setup({ status })
        await expect(
          initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session),
        ).rejects.toThrow(REGISTRATION_ERRORS.notOpen)
      },
    )

    it('rejects before the registration window opens and after the mun deadline', async () => {
      const early = await setup({ registrationOpensAt: new Date(Date.now() + 86_400_000) })
      await expect(
        initiateRegistration({ munId: early.mun.id, registrationProductId: early.product.id }, early.session),
      ).rejects.toThrow(REGISTRATION_ERRORS.notOpenYet)

      const late = await setup({ registrationDeadline: new Date(Date.now() - 86_400_000) })
      await expect(
        initiateRegistration({ munId: late.mun.id, registrationProductId: late.product.id }, late.session),
      ).rejects.toThrow(REGISTRATION_ERRORS.deadlinePassed)
    })

    it('accepts a mun whose window is open', async () => {
      const { mun, product, session } = await setup({
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationDeadline: new Date(Date.now() + 86_400_000),
      })
      const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
      expect(result.registrationId).toBeTruthy()
    })

    it('rejects an inactive pass and a pass past its own deadline', async () => {
      const { mun, product, session } = await setup()
      await db.update(registrationProducts).set({ status: 'inactive' }).where(eq(registrationProducts.id, product.id))
      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session),
      ).rejects.toThrow(REGISTRATION_ERRORS.passUnavailable)

      const expired = await createProduct(mun.id, 10)
      await db
        .update(registrationProducts)
        .set({ deadline: new Date(Date.now() - 60_000) })
        .where(eq(registrationProducts.id, expired.id))
      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: expired.id }, session),
      ).rejects.toThrow(REGISTRATION_ERRORS.passDeadlinePassed)
    })

    it('rejects a pass that belongs to a different mun', async () => {
      const { organizer, mun, session } = await setup()
      const otherMun = await createMun(organizer.id)
      const foreignPass = await createProduct(otherMun.id, 10)
      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: foreignPass.id }, session),
      ).rejects.toThrow(REGISTRATION_ERRORS.passWrongMun)
    })

    it('rejects a committee from a different mun, and a portfolio from a different committee', async () => {
      const { organizer, mun, product, session } = await setup()
      const otherMun = await createMun(organizer.id)
      const foreignCommittee = await createCommittee(otherMun.id, 10)
      await expect(
        initiateRegistration(
          { munId: mun.id, registrationProductId: product.id, committeeId: foreignCommittee.id },
          session,
        ),
      ).rejects.toThrow(REGISTRATION_ERRORS.committeeWrongMun)

      const ga = await createCommittee(mun.id, 10)
      const sc = await createCommittee(mun.id, 10)
      const scPortfolio = await createPortfolio(sc.id)
      await expect(
        initiateRegistration(
          { munId: mun.id, registrationProductId: product.id, committeeId: ga.id, portfolioId: scPortfolio.id },
          session,
        ),
      ).rejects.toThrow(REGISTRATION_ERRORS.portfolioWrongCommittee)

      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id, portfolioId: scPortfolio.id }, session),
      ).rejects.toThrow(REGISTRATION_ERRORS.portfolioNeedsCommittee)

      const noPortfolios = await createCommittee(mun.id, 10, { portfoliosEnabled: false })
      const hidden = await createPortfolio(noPortfolios.id)
      await expect(
        initiateRegistration(
          { munId: mun.id, registrationProductId: product.id, committeeId: noPortfolios.id, portfolioId: hidden.id },
          session,
        ),
      ).rejects.toThrow(REGISTRATION_ERRORS.portfoliosDisabled)

      // Nothing was created by any of the rejected attempts.
      const rows = await db.select().from(registrations).where(eq(registrations.munId, mun.id))
      expect(rows).toHaveLength(0)
    })

    it('records a valid committee + portfolio selection', async () => {
      const { mun, product, session } = await setup()
      const committee = await createCommittee(mun.id, 10)
      const portfolio = await createPortfolio(committee.id)
      const result = await initiateRegistration(
        { munId: mun.id, registrationProductId: product.id, committeeId: committee.id, portfolioId: portfolio.id },
        session,
      )
      const [row] = await db.select().from(registrations).where(eq(registrations.id, result.registrationId))
      expect(row?.committeeId).toBe(committee.id)
      expect(row?.portfolioId).toBe(portfolio.id)
    })

    it('never oversells committee capacity under concurrent registrations, across different passes', async () => {
      const organizer = await createUser('ORGANIZER')
      const mun = await createMun(organizer.id)
      const passA = await createProduct(mun.id, 100)
      const passB = await createProduct(mun.id, 100)
      const committee = await createCommittee(mun.id, 3)
      const students = await Promise.all(Array.from({ length: 10 }, () => createUser('STUDENT')))

      const results = await Promise.allSettled(
        students.map((student, i) =>
          initiateRegistration(
            {
              munId: mun.id,
              // Alternate passes so the pass row-lock alone can't serialize them.
              registrationProductId: i % 2 === 0 ? passA.id : passB.id,
              committeeId: committee.id,
            },
            studentSessionFor(student.id),
          ),
        ),
      )

      const succeeded = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      expect(succeeded).toHaveLength(3)
      expect(failed).toHaveLength(7)
      for (const failure of failed) {
        expect(String(failure.reason)).toMatch(/Committee is at capacity/)
      }

      const rows = await db.select().from(registrations).where(eq(registrations.committeeId, committee.id))
      const active = rows.filter((r) => ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'].includes(r.status))
      expect(active).toHaveLength(3)
    })

    it('never double-books a single-seat portfolio under concurrent registrations', async () => {
      const organizer = await createUser('ORGANIZER')
      const mun = await createMun(organizer.id)
      const passA = await createProduct(mun.id, 100)
      const passB = await createProduct(mun.id, 100)
      const committee = await createCommittee(mun.id, 100)
      const portfolio = await createPortfolio(committee.id, 1)
      const students = await Promise.all(Array.from({ length: 6 }, () => createUser('STUDENT')))

      const results = await Promise.allSettled(
        students.map((student, i) =>
          initiateRegistration(
            {
              munId: mun.id,
              registrationProductId: i % 2 === 0 ? passA.id : passB.id,
              committeeId: committee.id,
              portfolioId: portfolio.id,
            },
            studentSessionFor(student.id),
          ),
        ),
      )

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      for (const failure of results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]) {
        expect(String(failure.reason)).toMatch(/Portfolio is at capacity/)
      }
    })

    it('frees committee and portfolio seats when a hold on another pass expires or is cancelled', async () => {
      const { mun, product, session } = await setup()
      const otherPass = await createProduct(mun.id, 10)
      const committee = await createCommittee(mun.id, 1)
      const portfolio = await createPortfolio(committee.id, 1)
      const holder = await createUser('STUDENT')

      await db.insert(registrations).values({
        userId: holder.id,
        munId: mun.id,
        registrationProductId: otherPass.id,
        committeeId: committee.id,
        portfolioId: portfolio.id,
        status: 'PAYMENT_PENDING',
        expiresAt: new Date(Date.now() - 60_000),
      })

      const result = await initiateRegistration(
        { munId: mun.id, registrationProductId: product.id, committeeId: committee.id, portfolioId: portfolio.id },
        session,
      )
      expect(result.registrationId).toBeTruthy()
    })
  })

  it('throws Forbidden for an unauthenticated caller and never accepts a client-supplied userId', async () => {
    const organizer = await createUser('ORGANIZER')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)


    await expect(
      // @ts-expect-error -- intentionally probing that a userId field, even if
      // someone tried to smuggle one in, cannot bypass session derivation.
      initiateRegistration({ munId: mun.id, registrationProductId: product.id, userId: 'attacker-controlled-id' }, null),
    ).rejects.toThrow('Forbidden')
  })
})

describe('releaseExpiredReservations', () => {
  it('returns the count of released registrations and ignores non-expired ones', async () => {
    const organizer = await createUser('ORGANIZER')
    const studentA = await createUser('STUDENT')
    const studentB = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)

    await db.insert(registrations).values([
      {
        userId: studentA.id,
        munId: mun.id,
        registrationProductId: product.id,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        userId: studentB.id,
        munId: mun.id,
        registrationProductId: product.id,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 1000 * 60),
      },
    ])

    const count = await releaseExpiredReservations(product.id)
    expect(count).toBe(1)
  })

  it('emails only delegates whose checkout hold expired within the last hour', async () => {
    const organizer = await createUser('ORGANIZER')
    const recentCheckout = await createUser('STUDENT')
    const staleCheckout = await createUser('STUDENT')
    const unpaidHold = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const now = Date.now()
    const base = { munId: mun.id, registrationProductId: product.id }
    await db.insert(registrations).values([
      { ...base, userId: recentCheckout.id, status: 'PAYMENT_PENDING', expiresAt: new Date(now - 5 * 60 * 1000) },
      { ...base, userId: staleCheckout.id, status: 'PAYMENT_PENDING', expiresAt: new Date(now - 2 * 60 * 60 * 1000) },
      // PENDING never reached checkout: released silently.
      { ...base, userId: unpaidHold.id, status: 'PENDING', expiresAt: new Date(now - 5 * 60 * 1000) },
    ])

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const holdEmailRecipients = () =>
        log.mock.calls
          .filter(([tag, , subject]) => tag === '[notification]' && String(subject).startsWith('Your seat hold expired'))
          .map(([, to]) => to)

      expect(await releaseExpiredReservations(product.id)).toBe(3)

      // Sent in the background, after the release has committed.
      await vi.waitFor(() => expect(holdEmailRecipients()).toContain(recentCheckout.email))
      expect(holdEmailRecipients().filter((to) => to === staleCheckout.email || to === unpaidHold.email)).toEqual([])

      // Already released: a second sweep releases and emails nothing more.
      expect(await releaseExpiredReservations(product.id)).toBe(0)
      expect(holdEmailRecipients().filter((to) => to === recentCheckout.email)).toHaveLength(1)
    } finally {
      log.mockRestore()
    }
  })
})

describe('getProductsAvailability', () => {
  it('returns capacity/taken/available for multiple products in one call, matching getProductAvailability per-product', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const productA = await createProduct(mun.id, 10)
    const productB = await createProduct(mun.id, 5)

    await db.insert(registrations).values([
      { userId: student.id, munId: mun.id, registrationProductId: productA.id, status: 'CONFIRMED' },
      { userId: student.id, munId: mun.id, registrationProductId: productB.id, status: 'CONFIRMED' },
    ])

    const batched = new Map(await getProductsAvailability([productA.id, productB.id]))
    expect(batched.get(productA.id)).toEqual({ capacity: 10, taken: 1, available: 9 })
    expect(batched.get(productB.id)).toEqual({ capacity: 5, taken: 1, available: 4 })

    expect(await getProductAvailability(productA.id)).toEqual({ capacity: 10, taken: 1, available: 9 })
  })

  it('excludes CANCELLED/REFUNDED registrations from taken', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)

    await db.insert(registrations).values([
      { userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' },
      { userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CANCELLED' },
      { userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'REFUNDED' },
    ])

    const [[, availability]] = await getProductsAvailability([product.id])
    expect(availability).toEqual({ capacity: 10, taken: 1, available: 9 })
  })

  it('releases expired reservations across all requested products before counting', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const productA = await createProduct(mun.id, 10)
    const productB = await createProduct(mun.id, 10)

    await db.insert(registrations).values([
      {
        userId: student.id,
        munId: mun.id,
        registrationProductId: productA.id,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        userId: student.id,
        munId: mun.id,
        registrationProductId: productB.id,
        status: 'PAYMENT_PENDING',
        expiresAt: new Date(Date.now() - 1000),
      },
    ])

    const batched = new Map(await getProductsAvailability([productA.id, productB.id]))
    expect(batched.get(productA.id)?.taken).toBe(0)
    expect(batched.get(productB.id)?.taken).toBe(0)
  })

  it('returns an empty array for an empty input without querying', async () => {
    expect(await getProductsAvailability([])).toEqual([])
  })

  it('getProductAvailability throws for a nonexistent product', async () => {
    await expect(getProductAvailability('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'Registration product not found',
    )
  })
})

describe('getRegistrationById', () => {
  const studentSession = (userId: string) => ({ userId, role: 'STUDENT' as const })
  const adminSession = (userId: string) => ({ userId, role: 'ADMIN' as const })


  it('returns null when the registration does not exist', async () => {
    const organizer = await createUser('ORGANIZER')

    const result = await getRegistrationById('00000000-0000-0000-0000-000000000000', { userId: organizer.id, role: 'ORGANIZER' })
    expect(result).toBeNull()
  })

  it('allows the owning user to read their own registration', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const [reg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()


    const result = await getRegistrationById(reg.id, { userId: student.id, role: 'STUDENT' })
    expect(result?.id).toBe(reg.id)
  })

  it('allows an ADMIN to read any registration', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const admin = await createUser('ADMIN')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const [reg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()


    const result = await getRegistrationById(reg.id, { userId: admin.id, role: 'ADMIN' })
    expect(result?.id).toBe(reg.id)
  })

  it('allows the organizer of the registration mun to read it', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const [reg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()


    const result = await getRegistrationById(reg.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result?.id).toBe(reg.id)
  })

  it('throws Forbidden for an unrelated student trying to read someone else\'s registration', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const stranger = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const [reg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()


    await expect(getRegistrationById(reg.id, { userId: stranger.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden for an unauthenticated caller', async () => {
    await expect(getRegistrationById('00000000-0000-0000-0000-000000000000', null)).rejects.toThrow('Forbidden')
  })
})

describe('initiateRegistration — payments', () => {
  const ENV_KEYS = ['MOCK_PAYMENTS_ENABLED', 'PLATFORM_FEE_BPS', 'PLATFORM_FEE_TAX_BPS'] as const
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    vi.restoreAllMocks()
  })

  async function setup(productOverrides: Partial<typeof registrationProducts.$inferInsert> = {}) {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 1499, capacity: 10, ...productOverrides })
      .returning()
    return { organizer, student, mun, product, session: studentSessionFor(student.id) }
  }

  async function paymentFor(registrationId: string) {
    const [payment] = await db.select().from(payments).where(eq(payments.registrationId, registrationId))
    return payment
  }

  it('stores the provider, currency and additive platform-fee split on the payment', async () => {
    process.env.PLATFORM_FEE_BPS = '250'
    process.env.PLATFORM_FEE_TAX_BPS = '1800'
    const { mun, product, session } = await setup()

    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
    expect(result).toMatchObject({ status: 'PAYMENT_PENDING', replayed: false })

    // Additive model (docs/payments/SPEC.md §4.4): the delegate pays the
    // listed price PLUS the fee PLUS GST on the fee; the organizer is owed
    // the full listed price, unchanged — never a subtractive remainder.
    // 1499 listed; fee = round(1499*250/10000) = 37; tax = round(37*1800/10000) = 7;
    // amount charged = 1499 + 37 + 7 = 1543; organizerNet = 1499 exactly.
    expect(await paymentFor(result.registrationId)).toMatchObject({
      provider: 'mock_razorpay',
      providerOrderId: result.orderId,
      amount: 1543,
      currency: 'INR',
      platformFeeAmount: 37,
      platformFeeTaxAmount: 7,
      organizerNetAmount: 1499,
      status: 'PENDING',
    })
  })

  it('charges the early-bird price before its deadline, decided server-side', async () => {
    const { mun, product, session } = await setup({
      price: 2000,
      earlyBirdPrice: 1500,
      earlyBirdDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
    expect((await paymentFor(result.registrationId)).amount).toBe(1500)
  })

  it('charges the regular price once the early-bird deadline has passed', async () => {
    const { mun, product, session } = await setup({
      price: 2000,
      earlyBirdPrice: 1500,
      earlyBirdDeadline: new Date(Date.now() - 60_000),
    })
    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
    expect((await paymentFor(result.registrationId)).amount).toBe(2000)
  })

  it('adds accommodation to the early-bird pass price', async () => {
    const { mun, product, session } = await setup({
      price: 2000,
      earlyBirdPrice: 1500,
      earlyBirdDeadline: new Date(Date.now() + 60 * 60 * 1000),
    })
    const accommodation = await createAccommodation(mun.id, 5, 700)
    const result = await initiateRegistration(
      { munId: mun.id, registrationProductId: product.id, accommodationOptionId: accommodation.id },
      session,
    )
    expect((await paymentFor(result.registrationId)).amount).toBe(2200)
  })

  it('confirms a free pass immediately, with no order and no payment row', async () => {
    const { mun, product, session } = await setup({ price: 0 })
    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)

    expect(result).toEqual({ registrationId: result.registrationId, orderId: null, status: 'CONFIRMED', replayed: false })
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, result.registrationId))
    expect(registration.status).toBe('CONFIRMED')
    expect(registration.expiresAt).toBeNull()
    expect(await paymentFor(result.registrationId)).toBeUndefined()
  })

  it('refuses a paid pass when online payments are unavailable, without holding a seat', async () => {
    process.env.MOCK_PAYMENTS_ENABLED = 'false'
    const { mun, product, session, student } = await setup()

    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session),
    ).rejects.toThrow(REGISTRATION_ERRORS.paymentsUnavailable)
    expect(REGISTRATION_ERROR_STATUS[REGISTRATION_ERRORS.paymentsUnavailable]).toBe(503)

    const held = await db.select().from(registrations).where(eq(registrations.userId, student.id))
    expect(held).toHaveLength(0)
  })

  it('still confirms a free pass when online payments are unavailable', async () => {
    process.env.MOCK_PAYMENTS_ENABLED = 'false'
    const { mun, product, session } = await setup({ price: 0 })
    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
    expect(result.status).toBe('CONFIRMED')
  })

  it('fails before reserving when the platform fee is misconfigured', async () => {
    process.env.PLATFORM_FEE_BPS = 'lots'
    const { mun, product, session, student } = await setup()
    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session),
    ).rejects.toThrow(/PLATFORM_FEE_BPS/)
    expect(await db.select().from(registrations).where(eq(registrations.userId, student.id))).toHaveLength(0)
  })

  it('releases the seat at once when the provider cannot create an order, and lets the same key retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const createOrder = vi.spyOn(mockPaymentsAdapter, 'createOrder').mockRejectedValueOnce(new Error('gateway down'))
    const { mun, product, session, student } = await setup({ capacity: 1 })
    const idempotencyKey = crypto.randomUUID()

    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session, { idempotencyKey }),
    ).rejects.toThrow(REGISTRATION_ERRORS.paymentStartFailed)

    const [failed] = await db.select().from(registrations).where(eq(registrations.userId, student.id))
    expect(failed.status).toBe('CANCELLED')
    expect(failed.idempotencyKey).toBeNull()

    // The single seat is free again, and the same key starts a fresh attempt.
    const retry = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session, { idempotencyKey })
    expect(retry).toMatchObject({ status: 'PAYMENT_PENDING', replayed: false })
    expect(retry.registrationId).not.toBe(failed.id)
    expect(createOrder).toHaveBeenCalledTimes(2)
  })

  describe('idempotency', () => {
    it('returns the original registration for a repeated key', async () => {
      const { mun, product, session, student } = await setup()
      const idempotencyKey = crypto.randomUUID()
      const input = { munId: mun.id, registrationProductId: product.id }

      const first = await initiateRegistration(input, session, { idempotencyKey })
      const second = await initiateRegistration(input, session, { idempotencyKey })

      expect(second).toEqual({ ...first, replayed: true })
      expect(await db.select().from(registrations).where(eq(registrations.userId, student.id))).toHaveLength(1)
    })

    it('returns one registration to concurrent calls with the same key', async () => {
      const { mun, product, session, student } = await setup()
      const idempotencyKey = crypto.randomUUID()
      const input = { munId: mun.id, registrationProductId: product.id }

      const results = await Promise.all(
        Array.from({ length: 5 }, () => initiateRegistration(input, session, { idempotencyKey })),
      )
      expect(new Set(results.map((r) => r.registrationId)).size).toBe(1)
      expect(results.filter((r) => !r.replayed)).toHaveLength(1)
      expect(await db.select().from(registrations).where(eq(registrations.userId, student.id))).toHaveLength(1)
    })

    it('refuses a reused key for a different pass', async () => {
      const { mun, product, session } = await setup()
      const [otherProduct] = await db
        .insert(registrationProducts)
        .values({ munId: mun.id, name: 'Observer', price: 999, capacity: 10 })
        .returning()
      const idempotencyKey = crypto.randomUUID()

      await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session, { idempotencyKey })
      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: otherProduct.id }, session, { idempotencyKey }),
      ).rejects.toThrow(REGISTRATION_ERRORS.idempotencyKeyReused)
    })

    it('refuses concurrent calls that reuse one key across different passes', async () => {
      const { mun, product, session, student } = await setup()
      const [otherProduct] = await db
        .insert(registrationProducts)
        .values({ munId: mun.id, name: 'Observer', price: 999, capacity: 10 })
        .returning()
      const idempotencyKey = crypto.randomUUID()

      const results = await Promise.allSettled([
        initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session, { idempotencyKey }),
        initiateRegistration({ munId: mun.id, registrationProductId: otherProduct.id }, session, { idempotencyKey }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect(String(rejected.reason)).toContain(REGISTRATION_ERRORS.idempotencyKeyReused)
      expect(await db.select().from(registrations).where(eq(registrations.userId, student.id))).toHaveLength(1)
    })

    it('scopes keys to the user', async () => {
      const { mun, product, session } = await setup()
      const otherStudent = await createUser('STUDENT')
      const idempotencyKey = crypto.randomUUID()
      const input = { munId: mun.id, registrationProductId: product.id }

      const mine = await initiateRegistration(input, session, { idempotencyKey })
      const theirs = await initiateRegistration(input, studentSessionFor(otherStudent.id), { idempotencyKey })
      expect(theirs.replayed).toBe(false)
      expect(theirs.registrationId).not.toBe(mine.registrationId)
    })

    it('without a key, still rejects a second active registration', async () => {
      const { mun, product, session } = await setup()
      const input = { munId: mun.id, registrationProductId: product.id }
      await initiateRegistration(input, session)
      await expect(initiateRegistration(input, session)).rejects.toThrow(
        'You already have an active registration for this product',
      )
    })
  })
})

describe('getRegistrationReceipt', () => {
  async function paidRegistration() {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)
    const session = studentSessionFor(student.id)
    const { registrationId } = await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
    const [payment] = await db.select().from(payments).where(eq(payments.registrationId, registrationId))
    const webhook = simulatePaymentOutcome(
      { orderId: payment.providerOrderId, amount: payment.amount, currency: payment.currency },
      'success',
      { providerPaymentId: `pay_${registrationId}` },
    )
    await processPaymentWebhook(mockPaymentsAdapter, webhook.rawBody, webhook.headers)
    return { organizer, student, mun, product, session, registrationId, payment }
  }

  it('gives the delegate their receipt with the payment reference and paid date', async () => {
    const { session, registrationId, mun, payment } = await paidRegistration()
    const receipt = await getRegistrationReceipt(registrationId, session)

    expect(receipt).toMatchObject({
      registrationId,
      status: 'CONFIRMED',
      passName: 'Delegate',
      mun: { name: mun.name, slug: mun.slug },
      payment: {
        amount: 2500,
        currency: 'INR',
        status: 'PAID',
        reference: `pay_${registrationId}`,
        orderId: payment.providerOrderId,
      },
    })
    expect(receipt?.payment?.paidAt).toBeInstanceOf(Date)
    expect(receipt?.payment).not.toHaveProperty('platformFeeAmount')
  })

  it('is owner-only: the organizer, an admin and a stranger all get null', async () => {
    const { organizer, registrationId } = await paidRegistration()
    const admin = await createUser('ADMIN')
    const stranger = await createUser('STUDENT')

    expect(await getRegistrationReceipt(registrationId, { userId: organizer.id, role: 'ORGANIZER' })).toBeNull()
    expect(await getRegistrationReceipt(registrationId, { userId: admin.id, role: 'ADMIN' })).toBeNull()
    expect(await getRegistrationReceipt(registrationId, studentSessionFor(stranger.id))).toBeNull()
    await expect(getRegistrationReceipt(registrationId, null)).rejects.toThrow('Forbidden')
  })

  it('has no payment and no paid date before payment, and no payment at all for a free pass', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const paid = await createProduct(mun.id, 10)
    const [free] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Faculty', price: 0, capacity: 10 })
      .returning()
    const session = studentSessionFor(student.id)

    const pending = await initiateRegistration({ munId: mun.id, registrationProductId: paid.id }, session)
    const pendingReceipt = await getRegistrationReceipt(pending.registrationId, session)
    expect(pendingReceipt?.payment).toMatchObject({ status: 'PENDING', reference: null, paidAt: null })

    const confirmed = await initiateRegistration({ munId: mun.id, registrationProductId: free.id }, session)
    const freeReceipt = await getRegistrationReceipt(confirmed.registrationId, session)
    expect(freeReceipt).toMatchObject({ status: 'CONFIRMED', passName: 'Faculty', payment: null })
  })
})

afterAll(async () => {
  await db.$client.end()
})
