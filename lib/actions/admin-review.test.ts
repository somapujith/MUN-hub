import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, users, verificationLogs } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session'

// Mock next/headers `cookies()` so getSession() (called internally by every
// admin-review action) can read a token we control per-test, without a real
// Next.js request context. Each test sets `currentToken` before calling the
// action under test.
let currentToken: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && currentToken ? { value: currentToken } : undefined),
  }),
}))

import { getMunForReview, getReviewQueue, publishMun, reviewMunApplication } from './admin-review'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `${role}-${Date.now()}`, email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

async function sessionFor(userId: string) {
  const { token } = await createSession(userId)
  return token
}

async function makeMun(organizerId: string, status: 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFICATION') {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: `Review Mun ${Date.now()}-${Math.random()}`,
      slug: `review-mun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status,
    })
    .returning()
  return mun
}

describe('getReviewQueue', () => {
  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)
    await expect(getReviewQueue()).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    currentToken = undefined
    await expect(getReviewQueue()).rejects.toThrow('Forbidden')
  })

  it('returns SUBMITTED and UNDER_REVIEW muns for OPERATIONS', async () => {
    const organizer = await makeUser('ORGANIZER')
    const submitted = await makeMun(organizer.id, 'SUBMITTED')
    const underReview = await makeMun(organizer.id, 'UNDER_REVIEW')
    await makeMun(organizer.id, 'VERIFICATION') // should NOT appear

    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const queue = await getReviewQueue()
    const ids = queue.map((m) => m.id)
    expect(ids).toContain(submitted.id)
    expect(ids).toContain(underReview.id)
    expect(queue.every((m) => m.status === 'SUBMITTED' || m.status === 'UNDER_REVIEW')).toBe(true)
  })
})

describe('getMunForReview', () => {
  it('throws Forbidden for an ORGANIZER', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    currentToken = await sessionFor(organizer.id)
    await expect(getMunForReview(mun.id)).rejects.toThrow('Forbidden')
  })

  it('returns mun + organizerApplication + verificationLogs (with internalNotes) for ADMIN', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    await db.insert(organizerApplications).values({ organizerId: organizer.id, munId: mun.id, status: 'SUBMITTED' })
    await db
      .insert(verificationLogs)
      .values({ munId: mun.id, reviewerId: organizer.id, action: 'UNDER_REVIEW', notes: 'public note', internalNotes: 'secret ops note' })

    const admin = await makeUser('ADMIN')
    currentToken = await sessionFor(admin.id)

    const result = await getMunForReview(mun.id)
    expect(result.id).toBe(mun.id)
    expect(result.organizerApplication?.organizerId).toBe(organizer.id)
    expect(result.verificationLogs.length).toBeGreaterThanOrEqual(1)
    expect(result.verificationLogs.some((l) => l.internalNotes === 'secret ops note')).toBe(true)
  })

  it('throws Mun not found for a non-existent mun', async () => {
    const admin = await makeUser('ADMIN')
    currentToken = await sessionFor(admin.id)
    await expect(getMunForReview('does-not-exist')).rejects.toThrow('Mun not found')
  })
})

describe('reviewMunApplication', () => {
  it('approves a submitted mun when actor is OPERATIONS', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    const result = await reviewMunApplication(mun.id, 'APPROVED', 'looks good')
    expect(result.status).toBe('APPROVED')

    const logs = await db.select().from(verificationLogs).where(eq(verificationLogs.munId, mun.id))
    expect(logs.some((l) => l.action === 'APPROVED' && l.reviewerId === ops.id)).toBe(true)
  })

  it('rejects when actor is a STUDENT', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    const student = await makeUser('STUDENT')
    currentToken = await sessionFor(student.id)

    await expect(reviewMunApplication(mun.id, 'APPROVED')).rejects.toThrow('Forbidden')
  })

  it('reviews a mun straight from SUBMITTED (as returned by getReviewQueue) by claiming it into UNDER_REVIEW first', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    const admin = await makeUser('ADMIN')
    currentToken = await sessionFor(admin.id)

    const result = await reviewMunApplication(mun.id, 'APPROVED', 'approved on first review')
    expect(result.status).toBe('APPROVED')

    const logs = await db
      .select()
      .from(verificationLogs)
      .where(eq(verificationLogs.munId, mun.id))
      .orderBy(verificationLogs.createdAt)
    expect(logs.map((l) => l.action)).toEqual(['UNDER_REVIEW', 'APPROVED'])
    expect(logs.every((l) => l.reviewerId === admin.id)).toBe(true)
  })

  it('allows CHANGES_REQUESTED with notes and internalNotes persisted', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    const admin = await makeUser('ADMIN')
    currentToken = await sessionFor(admin.id)

    const result = await reviewMunApplication(mun.id, 'CHANGES_REQUESTED', 'fix dates', 'organizer is slow to respond')
    expect(result.status).toBe('CHANGES_REQUESTED')

    const logs = await db
      .select()
      .from(verificationLogs)
      .where(eq(verificationLogs.munId, mun.id))
    const log = logs.find((l) => l.action === 'CHANGES_REQUESTED')
    expect(log?.notes).toBe('fix dates')
    expect(log?.internalNotes).toBe('organizer is slow to respond')
  })
})

describe('publishMun', () => {
  it('rejects OPERATIONS (stricter than review — only ADMIN/SUPER_ADMIN can publish)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const ops = await makeUser('OPERATIONS')
    currentToken = await sessionFor(ops.id)

    await expect(publishMun(mun.id)).rejects.toThrow('Forbidden')
  })

  it('publishes when actor is ADMIN', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const admin = await makeUser('ADMIN')
    currentToken = await sessionFor(admin.id)

    const result = await publishMun(mun.id)
    expect(result.status).toBe('PUBLISHED')
    expect(result.publishedAt).toBeInstanceOf(Date)
  })
})

afterAll(async () => {
  await db.$client.end()
})
