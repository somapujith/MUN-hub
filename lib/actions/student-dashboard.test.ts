import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'

import { getUpcomingRegistrations, getPastRegistrations } from './student-dashboard'

describe('student dashboard queries', () => {
  let studentId: string
  let otherStudentId: string
  let futureMunId: string
  let pastMunId: string

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()

    const [student] = await db
      .insert(users)
      .values({ name: 'Student', email: `stu-${suffix}@test.com`, role: 'STUDENT' })
      .returning()
    studentId = student.id

    const [otherStudent] = await db
      .insert(users)
      .values({ name: 'Other Student', email: `stu-other-${suffix}@test.com`, role: 'STUDENT' })
      .returning()
    otherStudentId = otherStudent.id

    const [futureMun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Future Mun',
        slug: `future-mun-${suffix}`,
        startDate: new Date(Date.now() + 86_400_000),
      })
      .returning()
    futureMunId = futureMun.id

    const [pastMun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Past Mun',
        slug: `past-mun-${suffix}`,
        startDate: new Date(Date.now() - 86_400_000),
      })
      .returning()
    pastMunId = pastMun.id

    const [futureProduct] = await db
      .insert(registrationProducts)
      .values({ munId: futureMunId, name: 'Delegate', price: 1000, capacity: 10 })
      .returning()

    const [pastProduct] = await db
      .insert(registrationProducts)
      .values({ munId: pastMunId, name: 'Delegate', price: 1000, capacity: 10 })
      .returning()

    const [upcomingRegistration] = await db
      .insert(registrations)
      .values({
        userId: studentId,
        munId: futureMunId,
        registrationProductId: futureProduct.id,
        status: 'CONFIRMED',
      })
      .returning()

    await db.insert(registrations).values({
      userId: studentId,
      munId: pastMunId,
      registrationProductId: pastProduct.id,
      status: 'ATTENDED',
    })

    // Belongs to a different user entirely — must never leak into this
    // student's results (the core IDOR check).
    await db.insert(registrations).values({
      userId: otherStudentId,
      munId: futureMunId,
      registrationProductId: futureProduct.id,
      status: 'CONFIRMED',
    })

    const { payments } = await import('@/lib/db/schema')
    await db.insert(payments).values({
      registrationId: upcomingRegistration.id,
      providerOrderId: `order-${suffix}`,
      amount: 1000,
      status: 'PAID',
    })
  })

  it('throws Forbidden with no session', async () => {
    await expect(getUpcomingRegistrations(null)).rejects.toThrow('Forbidden')
    await expect(getPastRegistrations(null)).rejects.toThrow('Forbidden')
  })

  it('splits upcoming vs past correctly and includes the joined payment', async () => {
    const session: Session = { userId: studentId, role: 'STUDENT' }

    const upcoming = await getUpcomingRegistrations(session)
    expect(upcoming.length).toBe(1)
    expect(upcoming[0].mun.name).toBe('Future Mun')
    expect(upcoming[0].payment.length).toBe(1)
    expect(upcoming[0].payment[0].status).toBe('PAID')

    const past = await getPastRegistrations(session)
    expect(past.length).toBe(1)
    expect(past[0].mun.name).toBe('Past Mun')
  })

  it('lists every registration for a cancelled conference under past, never upcoming', async () => {
    const suffix = crypto.randomUUID()
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-cancel-${suffix}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [delegate] = await db
      .insert(users)
      .values({ name: 'Delegate', email: `stu-cancel-${suffix}@test.com`, role: 'STUDENT' })
      .returning()
    const [cancelledSoon, cancelledUndated] = await db
      .insert(muns)
      .values([
        {
          organizerId: organizer.id,
          name: 'Cancelled Future Mun',
          slug: `cancelled-future-${suffix}`,
          status: 'CANCELLED',
          startDate: new Date(Date.now() + 7 * 86_400_000),
        },
        { organizerId: organizer.id, name: 'Cancelled Undated Mun', slug: `cancelled-undated-${suffix}`, status: 'CANCELLED' },
      ])
      .returning()
    const [soonPass, undatedPass] = await db
      .insert(registrationProducts)
      .values([
        { munId: cancelledSoon.id, name: 'Delegate', price: 1000, capacity: 10 },
        { munId: cancelledUndated.id, name: 'Delegate', price: 1000, capacity: 10 },
      ])
      .returning()
    const [confirmed, releasedHold, undated] = await db
      .insert(registrations)
      .values([
        { userId: delegate.id, munId: cancelledSoon.id, registrationProductId: soonPass.id, status: 'CONFIRMED' },
        // An unpaid hold the cancellation released.
        { userId: delegate.id, munId: cancelledSoon.id, registrationProductId: soonPass.id, status: 'CANCELLED' },
        { userId: delegate.id, munId: cancelledUndated.id, registrationProductId: undatedPass.id, status: 'CONFIRMED' },
      ])
      .returning()
    const session: Session = { userId: delegate.id, role: 'STUDENT' }

    expect(await getUpcomingRegistrations(session)).toEqual([])

    const past = await getPastRegistrations(session)
    expect(past.map((row) => row.id).sort()).toEqual([confirmed.id, releasedHold.id, undated.id].sort())
    expect(past.every((row) => row.mun.status === 'CANCELLED')).toBe(true)
  })

  it('never returns another user\'s registrations', async () => {
    const session: Session = { userId: studentId, role: 'STUDENT' }

    const upcoming = await getUpcomingRegistrations(session)
    expect(upcoming.every((r) => r.userId === studentId)).toBe(true)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
