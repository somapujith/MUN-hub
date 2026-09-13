import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

// Same approach as student-dashboard.test.ts: only `next/headers` is stubbed
// (it requires a live request scope that doesn't exist under Vitest); the
// stub is backed by a real `sessions` row from the real `createSession()`, so
// `getSession()` itself runs unmocked against the real database.
let currentToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && currentToken ? { value: currentToken } : undefined),
  }),
}))

const { getMunOverview, getDelegateList } = await import('./organizer-dashboard')

async function asUser(userId: string) {
  const session = await createSession(userId)
  currentToken = session.token
}

describe('organizer dashboard queries', () => {
  it('computes overview totals for the owning organizer', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [student] = await db
      .insert(users)
      .values({ name: 'Student', email: `stu-${suffix}@test.com`, role: 'STUDENT' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Overview Mun', slug: `overview-mun-${suffix}` })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 2000, capacity: 5 })
      .returning()

    const [confirmedReg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
      .returning()

    await db.insert(payments).values({
      registrationId: confirmedReg.id,
      providerOrderId: `order-${suffix}`,
      amount: 2000,
      status: 'PAID',
    })

    const [pendingReg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()

    await db.insert(payments).values({
      registrationId: pendingReg.id,
      providerOrderId: `order-pending-${suffix}`,
      amount: 2000,
      status: 'PENDING',
    })

    await asUser(organizer.id)

    const overview = await getMunOverview(mun.id)
    expect(overview.totalRegistrations).toBe(1) // only CONFIRMED+ATTENDED count
    expect(overview.revenue).toBe(2000)
    expect(overview.pendingPayments).toBe(1)
    expect(overview.availableSeats).toBe(4) // capacity 5 - 1 counted registration
  })

  it('rejects a non-owning organizer', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [owner] = await db
      .insert(users)
      .values({ name: 'Owner', email: `owner-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [stranger] = await db
      .insert(users)
      .values({ name: 'Stranger', email: `stranger-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: owner.id, name: 'Locked Mun', slug: `locked-mun-${suffix}` })
      .returning()

    await asUser(stranger.id)

    await expect(getMunOverview(mun.id)).rejects.toThrow('Forbidden')
    await expect(getDelegateList(mun.id)).rejects.toThrow('Forbidden')
  })

  it('allows an admin to access any mun', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [owner] = await db
      .insert(users)
      .values({ name: 'Owner2', email: `owner2-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'Admin', email: `admin-${suffix}@test.com`, role: 'ADMIN' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: owner.id, name: 'Admin Mun', slug: `admin-mun-${suffix}` })
      .returning()

    await asUser(admin.id)

    const overview = await getMunOverview(mun.id)
    expect(overview.totalRegistrations).toBe(0)
  })

  it('applies the paymentStatus filter to the delegate list', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org3', email: `org3-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [studentA] = await db
      .insert(users)
      .values({ name: 'StudentA', email: `stua-${suffix}@test.com`, role: 'STUDENT' })
      .returning()
    const [studentB] = await db
      .insert(users)
      .values({ name: 'StudentB', email: `stub-${suffix}@test.com`, role: 'STUDENT' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Filter Mun', slug: `filter-mun-${suffix}` })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 10 })
      .returning()

    const [regA] = await db
      .insert(registrations)
      .values({ userId: studentA.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
      .returning()
    const [regB] = await db
      .insert(registrations)
      .values({ userId: studentB.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()

    await db.insert(payments).values({
      registrationId: regA.id,
      providerOrderId: `order-a-${suffix}`,
      amount: 1000,
      status: 'PAID',
    })
    await db.insert(payments).values({
      registrationId: regB.id,
      providerOrderId: `order-b-${suffix}`,
      amount: 1000,
      status: 'PENDING',
    })

    await asUser(organizer.id)

    const allDelegates = await getDelegateList(mun.id)
    expect(allDelegates.results.length).toBe(2)
    expect(allDelegates.total).toBe(2)

    const paidOnly = await getDelegateList(mun.id, { paymentStatus: 'PAID' })
    expect(paidOnly.results.length).toBe(1)
    expect(paidOnly.results[0].userId).toBe(studentA.id)
    expect(paidOnly.total).toBe(1)

    const pendingOnly = await getDelegateList(mun.id, { paymentStatus: 'PENDING' })
    expect(pendingOnly.results.length).toBe(1)
    expect(pendingOnly.results[0].userId).toBe(studentB.id)
  })

  it('paginates with limit/offset', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-page-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Page Mun', slug: `page-mun-${suffix}` })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 2000, capacity: 10 })
      .returning()

    for (let i = 0; i < 3; i++) {
      const [student] = await db
        .insert(users)
        .values({ name: `Student${i}`, email: `stu-page-${i}-${suffix}@test.com`, role: 'STUDENT' })
        .returning()
      await db.insert(registrations).values({
        userId: student.id,
        munId: mun.id,
        registrationProductId: product.id,
        status: 'CONFIRMED',
      })
    }

    await asUser(organizer.id)

    const page1 = await getDelegateList(mun.id, { limit: 2, offset: 0 })
    expect(page1.results.length).toBe(2)
    expect(page1.total).toBe(3)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
