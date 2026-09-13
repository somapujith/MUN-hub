import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { accommodationOptions, muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const mockGetSession = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getSession: () => mockGetSession(),
}))

const { initiateRegistration, releaseExpiredReservations, getRegistrationById, getProductAvailability, getProductsAvailability } =
  await import('./registration')

async function createUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' = 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email: `user-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

async function createMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Reg Mun', slug: `reg-mun-${Date.now()}-${Math.random()}` })
    .returning()
  return mun
}

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
  beforeEach(() => {
    mockGetSession.mockReset()
  })

  it('creates a PENDING->PAYMENT_PENDING registration and a payment order when capacity available', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)

    mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id })

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

    mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }),
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

    mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const result = await initiateRegistration({ munId: mun.id, registrationProductId: product.id })
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
    // now also rejects a second active registration from the same user, reusing
    // one session across all 10 calls would make most of them fail with "already
    // have an active registration" instead of exercising the capacity race.
    // getSession() is called synchronously near the top of each invocation, so
    // popping the next student off a queue on each mock invocation correctly
    // assigns one distinct student per concurrent call.
    const queue = [...students]
    mockGetSession.mockImplementation(() => Promise.resolve({ userId: queue.shift()!.id, role: 'STUDENT' }))

    const results = await Promise.allSettled(
      students.map(() => initiateRegistration({ munId: mun.id, registrationProductId: product.id })),
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

    mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const first = await initiateRegistration({ munId: mun.id, registrationProductId: product.id })
    expect(first.registrationId).toBeTruthy()

    await expect(
      initiateRegistration({ munId: mun.id, registrationProductId: product.id }),
    ).rejects.toThrow('You already have an active registration for this product')
  })

  it('allows a fresh registration after the previous one was cancelled (retry after failed payment)', async () => {
    const organizer = await createUser('ORGANIZER')
    const student = await createUser('STUDENT')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)

    mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const first = await initiateRegistration({ munId: mun.id, registrationProductId: product.id })

    await db
      .update(registrations)
      .set({ status: 'CANCELLED' })
      .where(eq(registrations.id, first.registrationId))

    const second = await initiateRegistration({ munId: mun.id, registrationProductId: product.id })
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

      mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

      const result = await initiateRegistration({
        munId: mun.id,
        registrationProductId: product.id,
        accommodationOptionId: accommodation.id,
        accommodationAnswers: { arrivalDate: '2027-03-09' },
      })

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
      const queue = [...students]
      mockGetSession.mockImplementation(() => Promise.resolve({ userId: queue.shift()!.id, role: 'STUDENT' }))

      const results = await Promise.allSettled(
        students.map(() =>
          initiateRegistration({ munId: mun.id, registrationProductId: product.id, accommodationOptionId: accommodation.id }),
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

      mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id, accommodationOptionId: accommodation.id }),
      ).rejects.toThrow('does not belong to this mun')
    })

    it('rejects an inactive (soft-deleted) accommodation option', async () => {
      const organizer = await createUser('ORGANIZER')
      const student = await createUser('STUDENT')
      const mun = await createMun(organizer.id)
      const product = await createProduct(mun.id, 10)
      const accommodation = await createAccommodation(mun.id, 10)
      await db.update(accommodationOptions).set({ status: 'inactive' }).where(eq(accommodationOptions.id, accommodation.id))

      mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

      await expect(
        initiateRegistration({ munId: mun.id, registrationProductId: product.id, accommodationOptionId: accommodation.id }),
      ).rejects.toThrow('not available')
    })
  })

  it('throws Forbidden for an unauthenticated caller and never accepts a client-supplied userId', async () => {
    const organizer = await createUser('ORGANIZER')
    const mun = await createMun(organizer.id)
    const product = await createProduct(mun.id, 10)

    mockGetSession.mockResolvedValue(null)

    await expect(
      // @ts-expect-error -- intentionally probing that a userId field, even if
      // someone tried to smuggle one in, cannot bypass session derivation.
      initiateRegistration({ munId: mun.id, registrationProductId: product.id, userId: 'attacker-controlled-id' }),
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
  beforeEach(() => {
    mockGetSession.mockReset()
  })

  it('returns null when the registration does not exist', async () => {
    const organizer = await createUser('ORGANIZER')
    mockGetSession.mockResolvedValue({ userId: organizer.id, role: 'ORGANIZER' })

    const result = await getRegistrationById('00000000-0000-0000-0000-000000000000')
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

    mockGetSession.mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const result = await getRegistrationById(reg.id)
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

    mockGetSession.mockResolvedValue({ userId: admin.id, role: 'ADMIN' })

    const result = await getRegistrationById(reg.id)
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

    mockGetSession.mockResolvedValue({ userId: organizer.id, role: 'ORGANIZER' })

    const result = await getRegistrationById(reg.id)
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

    mockGetSession.mockResolvedValue({ userId: stranger.id, role: 'STUDENT' })

    await expect(getRegistrationById(reg.id)).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden for an unauthenticated caller', async () => {
    mockGetSession.mockResolvedValue(null)
    await expect(getRegistrationById('00000000-0000-0000-0000-000000000000')).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
