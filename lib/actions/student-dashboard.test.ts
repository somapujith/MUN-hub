import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

// Only the Next.js-specific plumbing is stubbed here — `cookies()` requires a
// live request scope that doesn't exist under Vitest. The stub is backed by a
// real `sessions` row created via the real `createSession()`, so `getSession()`
// itself (the actual auth-derivation: cookie lookup -> sessions/users join ->
// expiry check) runs unmocked against the real database.
let currentToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && currentToken ? { value: currentToken } : undefined),
  }),
}))

const { getUpcomingRegistrations, getPastRegistrations } = await import('./student-dashboard')

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
    currentToken = undefined
    await expect(getUpcomingRegistrations()).rejects.toThrow('Forbidden')
    await expect(getPastRegistrations()).rejects.toThrow('Forbidden')
  })

  it('splits upcoming vs past correctly and includes the joined payment', async () => {
    const session = await createSession(studentId)
    currentToken = session.token

    const upcoming = await getUpcomingRegistrations()
    expect(upcoming.length).toBe(1)
    expect(upcoming[0].mun.name).toBe('Future Mun')
    expect(upcoming[0].payment.length).toBe(1)
    expect(upcoming[0].payment[0].status).toBe('PAID')

    const past = await getPastRegistrations()
    expect(past.length).toBe(1)
    expect(past[0].mun.name).toBe('Past Mun')
  })

  it('never returns another user\'s registrations', async () => {
    const session = await createSession(studentId)
    currentToken = session.token

    const upcoming = await getUpcomingRegistrations()
    expect(upcoming.every((r) => r.userId === studentId)).toBe(true)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
