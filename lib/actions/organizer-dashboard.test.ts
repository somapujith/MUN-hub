import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { getMunOverview, getDelegateList, getOrganizerWorkspaceOverview } from './organizer-dashboard'

function sess(user: { id: string; role: Session['role'] }): Session {
  return { userId: user.id, role: user.role }
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

    // A payment captured after its hold was released is a payment exception,
    // not revenue.
    const [releasedReg] = await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CANCELLED' })
      .returning()
    await db.insert(payments).values({
      registrationId: releasedReg.id,
      providerOrderId: `order-late-${suffix}`,
      amount: 2000,
      status: 'PAID',
      exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED',
    })

    const overview = await getMunOverview(mun.id, sess(organizer))
    expect(overview.totalRegistrations).toBe(1) // only CONFIRMED+ATTENDED count
    expect(overview.revenue).toBe(2000)
    // No fee breakdown on that payment: the whole amount is the organizer's.
    expect(overview.organizerNet).toBe(2000)
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

    await expect(getMunOverview(mun.id, sess(stranger))).rejects.toThrow('Forbidden')
    await expect(getDelegateList(mun.id, undefined, sess(stranger))).rejects.toThrow('Forbidden')
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

    const overview = await getMunOverview(mun.id, sess(admin))
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

    const allDelegates = await getDelegateList(mun.id, undefined, sess(organizer))
    expect(allDelegates.results.length).toBe(2)
    expect(allDelegates.total).toBe(2)

    const paidOnly = await getDelegateList(mun.id, { paymentStatus: 'PAID' }, sess(organizer))
    expect(paidOnly.results.length).toBe(1)
    expect(paidOnly.results[0].userId).toBe(studentA.id)
    expect(paidOnly.total).toBe(1)

    const pendingOnly = await getDelegateList(mun.id, { paymentStatus: 'PENDING' }, sess(organizer))
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

    const page1 = await getDelegateList(mun.id, { limit: 2, offset: 0 }, sess(organizer))
    expect(page1.results.length).toBe(2)
    expect(page1.total).toBe(3)
  })

  it('exposes only id/name/email/institution for each delegate, never passwordHash', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-leak-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [student] = await db
      .insert(users)
      .values({
        name: 'Leaky',
        email: `stu-leak-${suffix}@test.com`,
        role: 'STUDENT',
        phone: '9876543210',
        institution: 'KLH',
        passwordHash: 'scrypt$secret-hash',
      })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Leak Mun', slug: `leak-mun-${suffix}` })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 10 })
      .returning()
    await db
      .insert(registrations)
      .values({ userId: student.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })

    const { results } = await getDelegateList(mun.id, undefined, sess(organizer))
    expect(results).toHaveLength(1)
    expect(results[0].user).toEqual({ id: student.id, name: 'Leaky', email: student.email, institution: 'KLH' })
    expect(JSON.stringify(results)).not.toContain('secret-hash')
  })


  it('throws Mun not found for a missing mun id (shared assertOwnsOrAdmin)', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'OrgMissing', email: `org-missing-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    await expect(
      getMunOverview('00000000-0000-0000-0000-000000000000', sess(organizer)),
    ).rejects.toThrow('Mun not found')
    await expect(
      getDelegateList('00000000-0000-0000-0000-000000000000', undefined, sess(organizer)),
    ).rejects.toThrow('Mun not found')
  })

  it('aggregates workspace totals and per-mun summaries across every owned mun', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [organizer] = await db
      .insert(users)
      .values({ name: 'WorkspaceOrg', email: `wsorg-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [student] = await db
      .insert(users)
      .values({ name: 'WorkspaceStudent', email: `wsstu-${suffix}@test.com`, role: 'STUDENT' })
      .returning()

    const [munA] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Workspace Mun A', slug: `ws-mun-a-${suffix}` })
      .returning()
    const [munB] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Workspace Mun B', slug: `ws-mun-b-${suffix}` })
      .returning()

    const [productA] = await db
      .insert(registrationProducts)
      .values({ munId: munA.id, name: 'Delegate', price: 1000, capacity: 5, status: 'active' })
      .returning()
    // Inactive product's capacity must not count toward the mun's total.
    await db
      .insert(registrationProducts)
      .values({ munId: munA.id, name: 'Retired pass', price: 1000, capacity: 100, status: 'inactive' })
    const [productB] = await db
      .insert(registrationProducts)
      .values({ munId: munB.id, name: 'Delegate', price: 1000, capacity: 3, status: 'active' })
      .returning()

    await db
      .insert(registrations)
      .values({ userId: student.id, munId: munA.id, registrationProductId: productA.id, status: 'CONFIRMED' })
    await db
      .insert(registrations)
      .values({ userId: student.id, munId: munA.id, registrationProductId: productA.id, status: 'PAYMENT_PENDING' })
    await db
      .insert(registrations)
      .values({ userId: student.id, munId: munB.id, registrationProductId: productB.id, status: 'CANCELLED' })

    const overview = await getOrganizerWorkspaceOverview(sess(organizer))

    expect(overview.muns.map((mun) => mun.id).sort()).toEqual([munA.id, munB.id].sort())
    const summaryA = overview.muns.find((mun) => mun.id === munA.id)!
    expect(summaryA.confirmedCount).toBe(1)
    expect(summaryA.registrationCount).toBe(2) // CONFIRMED + PAYMENT_PENDING
    expect(summaryA.capacity).toBe(5) // inactive product excluded
    const summaryB = overview.muns.find((mun) => mun.id === munB.id)!
    expect(summaryB.confirmedCount).toBe(0) // CANCELLED doesn't count
    expect(summaryB.registrationCount).toBe(0)
    expect(summaryB.capacity).toBe(3)

    expect(overview.totals).toEqual({
      registrations: 2,
      confirmed: 1,
      pending: 1,
      capacity: 8,
      availableSeats: 7,
    })
  })

  it('returns an empty overview for an organizer who owns no muns', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'NoMunsOrg', email: `no-muns-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const overview = await getOrganizerWorkspaceOverview(sess(organizer))
    expect(overview.muns).toEqual([])
    expect(overview.totals).toEqual({ registrations: 0, confirmed: 0, pending: 0, capacity: 0, availableSeats: 0 })
  })

  it('rejects an unauthenticated caller for the workspace overview', async () => {
    await expect(getOrganizerWorkspaceOverview(null)).rejects.toThrow('Forbidden')
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
