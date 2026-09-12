import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const mockGetSession = vi.fn()

vi.mock('@/lib/auth/session', () => ({
  getSession: () => mockGetSession(),
}))

const { initiateRegistration, releaseExpiredReservations, getRegistrationById } = await import('./registration')

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

    // The overbooking bug is keyed on registrationProductId, not on which
    // user is registering, so a single shared session is enough to exercise
    // the real race (10 concurrent calls against one product with capacity 3).
    mockGetSession.mockResolvedValue({ userId: students[0].id, role: 'STUDENT' })

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
