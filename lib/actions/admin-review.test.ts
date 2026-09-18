import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, notInArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  adminActions,
  committees,
  muns,
  munModuleVerifications,
  munSubmissions,
  organizerApplications,
  registrationProducts,
  registrations,
  users,
  verificationLogs,
} from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { reviewSubmission } from '@/lib/lifecycle/go-live'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import { listAdminActions } from './admin-audit'
import { recordPiiRead } from './admin-pii-read'

import {
  getAdminMunModuleContent,
  getModuleReviewQueue,
  getMunForReview,
  getRegistrationsQueue,
  getReviewQueue,
  publishMun,
  reinstateMun,
  reviewMunApplication,
  suspendMun,
  unpublishMun,
} from './admin-review'

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `${role}-${Date.now()}`, email: `${role.toLowerCase()}-${Date.now()}-${Math.random()}@test.com`, role })
    .returning()
  return user
}

function sess(user: { id: string; role: Session['role'] }): Session {
  return { userId: user.id, role: user.role }
}

async function makeMun(
  organizerId: string,
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFICATION' | 'VERIFIED' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'SUSPENDED',
) {
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

/**
 * `getReviewQueue` now joins `organizerApplications` (filtering by the
 * application's own decision status, not `muns.status` — see its doc
 * comment), so a queue-eligible fixture needs both rows, matching what the
 * real submission flow (`submitOrganizerApplication`) always creates
 * together. `applicationStatus` defaults to 'SUBMITTED' (pending).
 */
async function makeQueuedMun(
  organizerId: string,
  munStatus: 'SUBMITTED' | 'UNDER_REVIEW',
  applicationStatus: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' = 'SUBMITTED',
) {
  const mun = await makeMun(organizerId, munStatus)
  await db.insert(organizerApplications).values({ organizerId, munId: mun.id, status: applicationStatus })
  return mun
}

describe('getReviewQueue', () => {
  it('throws Forbidden for a STUDENT', async () => {
    const student = await makeUser('STUDENT')
    const __actor = sess(student)
    await expect(getReviewQueue({}, __actor)).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden with no session', async () => {
    const __actor = null as Session | null
    await expect(getReviewQueue({}, __actor)).rejects.toThrow('Forbidden')
  })

  it('returns SUBMITTED and UNDER_REVIEW muns for OPERATIONS (pending application status)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const submitted = await makeQueuedMun(organizer.id, 'SUBMITTED')
    const underReview = await makeQueuedMun(organizer.id, 'UNDER_REVIEW')
    await makeMun(organizer.id, 'VERIFICATION') // no application row at all — should NOT appear

    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    const queue = await getReviewQueue({}, __actor)
    const ids = queue.results.map((m) => m.id)
    expect(ids).toContain(submitted.id)
    expect(ids).toContain(underReview.id)
    expect(queue.results.every((m) => m.status === 'SUBMITTED' || m.status === 'UNDER_REVIEW')).toBe(true)
    expect(queue.total).toBeGreaterThanOrEqual(2)
  })

  it('paginates with limit/offset', async () => {
    const organizer = await makeUser('ORGANIZER')
    for (let i = 0; i < 3; i++) {
      await makeQueuedMun(organizer.id, 'SUBMITTED')
    }

    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    const page1 = await getReviewQueue({ limit: 2, offset: 0 }, __actor)
    expect(page1.results.length).toBe(2)
    expect(page1.total).toBeGreaterThanOrEqual(3)
  })

  it('filters by application status: a decided application is absent from the default (SUBMITTED) queue', async () => {
    const organizer = await makeUser('ORGANIZER')
    const approved = await makeQueuedMun(organizer.id, 'SUBMITTED', 'APPROVED')

    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    const pending = await getReviewQueue({}, __actor)
    expect(pending.results.some((m) => m.id === approved.id)).toBe(false)

    const approvedQueue = await getReviewQueue({ status: 'APPROVED' }, __actor)
    expect(approvedQueue.results.some((m) => m.id === approved.id)).toBe(true)
  })

  it('searches by MUN name and by organizer name/email', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeQueuedMun(organizer.id, 'SUBMITTED')
    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    const byMunName = await getReviewQueue({ search: mun.name.slice(0, 10) }, __actor)
    expect(byMunName.results.some((m) => m.id === mun.id)).toBe(true)

    const byOrganizerEmail = await getReviewQueue({ search: organizer.email }, __actor)
    expect(byOrganizerEmail.results.some((m) => m.id === mun.id)).toBe(true)

    const byNoMatch = await getReviewQueue({ search: `no-such-thing-${crypto.randomUUID()}` }, __actor)
    expect(byNoMatch.results.some((m) => m.id === mun.id)).toBe(false)
  })
})

describe('getMunForReview', () => {
  it('throws Forbidden for an ORGANIZER', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    const __actor = sess(organizer)
    await expect(getMunForReview(mun.id, __actor)).rejects.toThrow('Forbidden')
  })

  it('returns mun + organizerApplication + verificationLogs (with internalNotes) for ADMIN', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    await db.insert(organizerApplications).values({ organizerId: organizer.id, munId: mun.id, status: 'SUBMITTED' })
    await db
      .insert(verificationLogs)
      .values({ munId: mun.id, reviewerId: organizer.id, action: 'UNDER_REVIEW', notes: 'public note', internalNotes: 'secret ops note' })

    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const result = await getMunForReview(mun.id, __actor)
    expect(result.id).toBe(mun.id)
    expect(result.organizerApplication?.organizerId).toBe(organizer.id)
    expect(result.verificationLogs.length).toBeGreaterThanOrEqual(1)
    expect(result.verificationLogs.some((l) => l.internalNotes === 'secret ops note')).toBe(true)
  })

  it('throws Mun not found for a non-existent mun', async () => {
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)
    await expect(getMunForReview('does-not-exist', __actor)).rejects.toThrow('Mun not found')
  })
})

async function makeApplication(organizerId: string, munId: string) {
  await db.insert(organizerApplications).values({ organizerId, munId, status: 'SUBMITTED' })
}

async function applicationStatus(munId: string) {
  const [row] = await db
    .select({ status: organizerApplications.status, reviewNotes: organizerApplications.reviewNotes })
    .from(organizerApplications)
    .where(eq(organizerApplications.munId, munId))
  return row
}

async function logActions(munId: string) {
  const logs = await db
    .select()
    .from(verificationLogs)
    .where(eq(verificationLogs.munId, munId))
    .orderBy(verificationLogs.createdAt)
  return logs
}

describe('reviewMunApplication', () => {
  it('approves an UNDER_REVIEW mun (OPERATIONS) and exits Gate 1 into ONBOARDING', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    await makeApplication(organizer.id, mun.id)
    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    const result = await reviewMunApplication(mun.id, 'APPROVED', 'looks good', undefined, __actor)
    expect(result.status).toBe('ONBOARDING')

    const logs = await logActions(mun.id)
    expect(logs.map((l) => l.action)).toEqual(['APPROVED', 'ONBOARDING'])
    expect(logs.every((l) => l.reviewerId === ops.id)).toBe(true)
    expect(logs[0].notes).toBe('looks good')
    expect(await applicationStatus(mun.id)).toEqual({ status: 'APPROVED', reviewNotes: 'looks good' })
  })

  it.each(['REJECTED', 'CHANGES_REQUESTED'] as const)(
    'refuses %s without a reason and changes nothing',
    async (decision) => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, 'SUBMITTED')
      await makeApplication(organizer.id, mun.id)
      const __actor = sess(await makeUser('ADMIN'))

      for (const notes of [undefined, '', '   ']) {
        await expect(reviewMunApplication(mun.id, decision, notes, 'internal only', __actor)).rejects.toThrow(
          'A reason is required to reject or request changes',
        )
      }
      const [after] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(after.status).toBe('SUBMITTED')
      expect(await logActions(mun.id)).toHaveLength(0)
      expect((await applicationStatus(mun.id)).status).toBe('SUBMITTED')
    },
  )

  it('mirrors REJECTED onto the organizer application with the reason', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    await makeApplication(organizer.id, mun.id)
    const __actor = sess(await makeUser('ADMIN'))

    const result = await reviewMunApplication(mun.id, 'REJECTED', '  could not verify  ', undefined, __actor)
    expect(result.status).toBe('REJECTED')
    expect(await applicationStatus(mun.id)).toEqual({ status: 'REJECTED', reviewNotes: 'could not verify' })
  })

  it('rolls back the claim when the decision itself fails', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    const __actor = sess(await makeUser('ADMIN'))

    await expect(
      reviewMunApplication(mun.id, 'PUBLISHED' as unknown as 'APPROVED', 'a note', undefined, __actor),
    ).rejects.toThrow('Invalid transition from UNDER_REVIEW to PUBLISHED')
    const [after] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(after.status).toBe('SUBMITTED')
    expect(await logActions(mun.id)).toHaveLength(0)
  })

  it('a second decision on an already-decided application is refused', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    await makeApplication(organizer.id, mun.id)
    const __actor = sess(await makeUser('ADMIN'))

    await reviewMunApplication(mun.id, 'APPROVED', undefined, undefined, __actor)
    await expect(reviewMunApplication(mun.id, 'REJECTED', 'too late', undefined, __actor)).rejects.toThrow(
      'Invalid transition from ONBOARDING to REJECTED',
    )
    expect((await applicationStatus(mun.id)).status).toBe('APPROVED')
  })

  it('rejects when actor is a STUDENT', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    const student = await makeUser('STUDENT')
    const __actor = sess(student)

    await expect(reviewMunApplication(mun.id, 'APPROVED', undefined, undefined, __actor)).rejects.toThrow('Forbidden')
  })

  it('reviews a mun straight from SUBMITTED (as returned by getReviewQueue) by claiming it into UNDER_REVIEW first', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUBMITTED')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const result = await reviewMunApplication(mun.id, 'APPROVED', 'approved on first review', undefined, __actor)
    expect(result.status).toBe('ONBOARDING')

    // One transaction, but each hop is its own ordered audit row.
    const logs = await logActions(mun.id)
    expect(logs.map((l) => l.action)).toEqual(['UNDER_REVIEW', 'APPROVED', 'ONBOARDING'])
    expect(new Set(logs.map((l) => l.createdAt.getTime())).size).toBe(3)
    expect(logs.every((l) => l.reviewerId === admin.id)).toBe(true)
  })

  it('allows CHANGES_REQUESTED with notes and internalNotes persisted', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    await makeApplication(organizer.id, mun.id)
    const result = await reviewMunApplication(mun.id, 'CHANGES_REQUESTED', 'fix dates', 'organizer is slow to respond', __actor)
    expect(result.status).toBe('CHANGES_REQUESTED')
    expect(await applicationStatus(mun.id)).toEqual({ status: 'CHANGES_REQUESTED', reviewNotes: 'fix dates' })

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
    const __actor = sess(ops)

    await expect(publishMun(mun.id, __actor)).rejects.toThrow('Forbidden')
  })

  // No active mun_submissions row exists for this mun (created directly in
  // VERIFIED status, like seed data or a pre-Task-11 mun) — publishMun must
  // fall back to the original direct transitionMun call unchanged. This test
  // is unmodified from before Task 11 per the brief's backward-compatibility
  // requirement.
  it('publishes when actor is ADMIN', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFIED')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const result = await publishMun(mun.id, __actor)
    expect(result.status).toBe('PUBLISHED')
    expect(result.publishedAt).toBeInstanceOf(Date)
  })
})

describe('unpublishMun', () => {
  // INTENTIONAL BEHAVIOR CHANGE (Task 11, 2026-09-14): unpublishMun used to
  // target VERIFIED. It now targets UNPUBLISHED (spec Section 1.4) — a
  // status added specifically so "admin pulled this off the marketplace" is
  // distinguishable from VERIFIED ("content verified, never yet published").
  // This test was updated to assert the new target; see admin-review.ts's
  // updated docstring on unpublishMun for the full reasoning.
  it('transitions PUBLISHED -> UNPUBLISHED and logs MUN_UNPUBLISHED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'PUBLISHED')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const updated = await unpublishMun(mun.id, __actor)
    expect(updated.status).toBe('UNPUBLISHED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, mun.id))
    expect(log.action).toBe('MUN_UNPUBLISHED')
  })

  it('rejects OPERATIONS (stricter than review — only ADMIN/SUPER_ADMIN can unpublish)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'PUBLISHED')
    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    await expect(unpublishMun(mun.id, __actor)).rejects.toThrow('Forbidden')
  })
})

describe('suspendMun', () => {
  it('transitions REGISTRATION_OPEN -> SUSPENDED with reason, logs MUN_SUSPENDED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'REGISTRATION_OPEN')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const updated = await suspendMun(mun.id, 'safety concern', __actor)
    expect(updated.status).toBe('SUSPENDED')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, mun.id))
    expect(log.action).toBe('MUN_SUSPENDED')
    expect(log.reason).toBe('safety concern')
  })

  it('two concurrent suspend calls on the same mun serialize (row lock) — exactly one succeeds', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'PUBLISHED')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const [r1, r2] = await Promise.allSettled([
      suspendMun(mun.id, 'reason A', __actor),
      suspendMun(mun.id, 'reason B', __actor),
    ])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    const rejected = [r1, r2].filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })
})

describe('reinstateMun', () => {
  it('transitions SUSPENDED -> VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUSPENDED')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const updated = await reinstateMun(mun.id, __actor)
    expect(updated.status).toBe('VERIFICATION')
  })

  it('rejects OPERATIONS (stricter than review — only ADMIN/SUPER_ADMIN can reinstate)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUSPENDED')
    const ops = await makeUser('OPERATIONS')
    const __actor = sess(ops)

    await expect(reinstateMun(mun.id, __actor)).rejects.toThrow('Forbidden')
  })

  // A previously published mun's only submission is PUBLISHED (terminal), so
  // without a fresh round the reinstated mun was stranded: reviewSubmission
  // threw "No active submission found", no module sat in PENDING_REVIEW, and
  // enqueueForGoLive refuses status VERIFICATION.
  it('opens a fresh review round so the mun can be approved and go live again', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUSPENDED')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)
    await db.insert(munSubmissions).values({
      munId: mun.id,
      submittedBy: organizer.id,
      versionNumber: 1,
      status: 'PUBLISHED',
      slaDeadline: new Date(),
    })

    await reinstateMun(mun.id, __actor)

    const [submission] = await db
      .select({ status: munSubmissions.status, versionNumber: munSubmissions.versionNumber })
      .from(munSubmissions)
      .where(and(eq(munSubmissions.munId, mun.id), notInArray(munSubmissions.status, ['PUBLISHED', 'REJECTED', 'WITHDRAWN'])))
    expect(submission).toMatchObject({ status: 'SUBMITTED', versionNumber: 2 })

    const approved = await reviewSubmission(mun.id, 'APPROVED', {}, __actor)
    expect(approved.status).toBe('APPROVED')
    const [after] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(after.status).toBe('VERIFIED')
  })

  it('reuses an existing active submission instead of opening a second one', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'SUSPENDED')
    const admin = await makeUser('ADMIN')
    await db.insert(munSubmissions).values({
      munId: mun.id,
      submittedBy: organizer.id,
      versionNumber: 3,
      status: 'UNDER_REVIEW',
      slaDeadline: new Date(),
    })

    await reinstateMun(mun.id, sess(admin))

    const rows = await db.select({ id: munSubmissions.id }).from(munSubmissions).where(eq(munSubmissions.munId, mun.id))
    expect(rows).toHaveLength(1)
  })
})

describe('getModuleReviewQueue', () => {
  it('returns PENDING_REVIEW module rows with mun name, requires reviewer role', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'committees', state: 'PENDING_REVIEW', organizerConfirmedAt: new Date() })

    const __actor = sess(reviewer)
    // The local dev DB accumulates historical PENDING_REVIEW rows across test
    // runs (documented in CLAUDE.md) — order by organizerConfirmedAt desc
    // means a freshly-created row isn't guaranteed to land on page 1 at the
    // default limit, so query with a limit large enough to cover accumulated
    // local junk instead of relying on ordering luck.
    const queue = await getModuleReviewQueue({ limit: 1000 }, __actor)
    expect(queue.results.some((row) => row.munId === mun.id && row.munName === mun.name)).toBe(true)
    expect(queue.total).toBeGreaterThanOrEqual(1)
  })

  it('rejects a STUDENT session', async () => {
    const student = await makeUser('STUDENT')
    const __actor = sess(student)

    await expect(getModuleReviewQueue({}, __actor)).rejects.toThrow('Forbidden')
  })

  it('filters by status: VERIFIED rows are absent from the default (PENDING_REVIEW) queue', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'committees', state: 'VERIFIED', organizerConfirmedAt: new Date() })

    const __actor = sess(reviewer)
    const pending = await getModuleReviewQueue({ limit: 1000 }, __actor)
    expect(pending.results.some((row) => row.munId === mun.id)).toBe(false)

    const verified = await getModuleReviewQueue({ status: 'VERIFIED', limit: 1000 }, __actor)
    expect(verified.results.some((row) => row.munId === mun.id)).toBe(true)
  })

  it('searches by MUN name', async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const marker = `Verify Search Mun ${crypto.randomUUID()}`
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: marker, slug: `verify-search-${crypto.randomUUID()}`, status: 'VERIFICATION' })
      .returning()
    await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'committees', state: 'PENDING_REVIEW', organizerConfirmedAt: new Date() })

    const __actor = sess(reviewer)
    const byName = await getModuleReviewQueue({ search: marker }, __actor)
    expect(byName.results.some((row) => row.munId === mun.id)).toBe(true)
    expect(byName.total).toBe(1)

    const byNoMatch = await getModuleReviewQueue({ search: `no-such-thing-${crypto.randomUUID()}` }, __actor)
    expect(byNoMatch.results.some((row) => row.munId === mun.id)).toBe(false)
  })
})

describe('getAdminMunModuleContent', () => {
  it('rejects a STUDENT session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const student = await makeUser('STUDENT')

    await expect(getAdminMunModuleContent(mun.id, sess(student))).rejects.toThrow('Forbidden')
  })

  it('rejects with no session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')

    await expect(getAdminMunModuleContent(mun.id, null)).rejects.toThrow('Forbidden')
  })

  // This is the exact case that would break if this action used
  // assertOwnsOrAdmin instead of a direct role check — that helper does not
  // cover OPERATIONS (see CLAUDE.md's LOCKED-enforcement section).
  it('succeeds for an OPERATIONS session', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const ops = await makeUser('OPERATIONS')

    const result = await getAdminMunModuleContent(mun.id, sess(ops))
    expect(result.munId).toBe(mun.id)
    expect(result.munName).toBe(mun.name)
  })

  it('returns the loadValidationContext batch verbatim, including seeded committees and registration products', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    const [committee] = await db
      .insert(committees)
      .values({ munId: mun.id, name: 'UNSC', agenda: 'Nuclear disarmament', capacity: 20 })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate pass', price: 500, capacity: 20 })
      .returning()

    const admin = await makeUser('ADMIN')
    const result = await getAdminMunModuleContent(mun.id, sess(admin))

    expect(result.munId).toBe(mun.id)
    expect(result.munName).toBe(mun.name)
    expect(result.context.mun.id).toBe(mun.id)
    expect(result.context.committees.map((c) => c.id)).toContain(committee.id)
    expect(result.context.registrationProducts.map((p) => p.id)).toContain(product.id)
    // A batched read of everything loadValidationContext loads, not just the
    // two modules seeded above.
    expect(result.context).toHaveProperty('portfolios')
    expect(result.context).toHaveProperty('ebMembers')
    expect(result.context).toHaveProperty('formFields')
    expect(result.context).toHaveProperty('paymentSettings')
    expect(result.context).toHaveProperty('documents')
    expect(result.context).toHaveProperty('scheduleItems')
    expect(result.context).toHaveProperty('contact')
    expect(result.context).toHaveProperty('media')
    expect(result.context).toHaveProperty('accommodationOptions')
  })

  it('throws Mun not found for a non-existent mun', async () => {
    const admin = await makeUser('ADMIN')
    await expect(getAdminMunModuleContent('does-not-exist', sess(admin))).rejects.toThrow('not found')
  })
})

describe('getRegistrationsQueue', () => {
  async function registeredDelegate() {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'PUBLISHED')
    const tag = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    const [delegate] = await db
      .insert(users)
      .values({ name: `Delegate ${tag}`, email: `Search_Me.${tag}@Example.test`, role: 'STUDENT' })
      .returning()
    const [product] = await db
      .insert(registrationProducts)
      .values({ munId: mun.id, name: 'Delegate pass', price: 100, capacity: 10 })
      .returning()
    const [registration] = await db
      .insert(registrations)
      .values({ userId: delegate.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' })
      .returning()
    return { delegate, registration }
  }

  it('matches the delegate email, case-insensitively and by fragment', async () => {
    const { delegate, registration } = await registeredDelegate()
    const __actor = sess(await makeUser('OPERATIONS'))

    for (const q of [delegate.email, delegate.email.toLowerCase(), delegate.email.split('@')[0].toUpperCase()]) {
      const { results, total } = await getRegistrationsQueue({ q }, __actor)
      expect(results.map((r) => r.id), q).toEqual([registration.id])
      expect(total).toBe(1)
    }
  })

  it('treats LIKE wildcards in the query literally', async () => {
    await registeredDelegate()
    const __actor = sess(await makeUser('OPERATIONS'))
    const { total } = await getRegistrationsQueue({ q: `Search_Me.%${'_'.repeat(3)}@` }, __actor)
    expect(total).toBe(0)
  })
})

describe('listAdminActions (platform audit feed)', () => {
  async function feedFor(munId: string, __actor: Session) {
    const { results } = await listAdminActions({ limit: 100 }, __actor)
    return results.filter((row) => row.targetType === 'mun' && row.targetId === munId)
  }

  it('lists each Gate 1 decision once, labelled APPLICATION_<decision>, with its reason', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)

    const approved = await makeMun(organizer.id, 'SUBMITTED')
    const rejected = await makeMun(organizer.id, 'SUBMITTED')
    // Real UNDER_REVIEW muns always carry the logged SUBMITTED -> UNDER_REVIEW
    // claim, which is what identifies the next row as a Gate 1 decision.
    const changes = await makeMun(organizer.id, 'SUBMITTED')
    await transitionMun(changes.id, 'UNDER_REVIEW', admin.id)
    await reviewMunApplication(approved.id, 'APPROVED', undefined, undefined, __actor)
    await reviewMunApplication(rejected.id, 'REJECTED', 'fraud', undefined, __actor)
    await reviewMunApplication(changes.id, 'CHANGES_REQUESTED', 'add venue', undefined, __actor)

    const approvedRows = await feedFor(approved.id, __actor)
    expect(approvedRows.map((r) => r.action)).toEqual(['APPLICATION_APPROVED'])
    expect(approvedRows[0]).toMatchObject({ actorId: admin.id, actorName: admin.name, reason: null })
    expect(approvedRows[0].createdAt).toBeInstanceOf(Date)

    expect((await feedFor(rejected.id, __actor)).map((r) => [r.action, r.reason])).toEqual([
      ['APPLICATION_REJECTED', 'fraud'],
    ])
    expect((await feedFor(changes.id, __actor)).map((r) => [r.action, r.reason])).toEqual([
      ['APPLICATION_CHANGES_REQUESTED', 'add venue'],
    ])
  })

  it('does not pick up a Gate 2 REJECTED transition (it leaves VERIFICATION, not UNDER_REVIEW)', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    await transitionMun(mun.id, 'REJECTED', admin.id, 'content is fake')

    expect(await feedFor(mun.id, sess(admin))).toEqual([])
  })

  it('still lists admin_actions rows, and the total counts both sources', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)
    const before = (await listAdminActions({ limit: 1 }, __actor)).total

    const live = await makeMun(organizer.id, 'PUBLISHED')
    await unpublishMun(live.id, __actor)
    const applied = await makeMun(organizer.id, 'SUBMITTED')
    await reviewMunApplication(applied.id, 'REJECTED', 'no', undefined, __actor)

    expect((await feedFor(live.id, __actor)).map((r) => r.action)).toEqual(['MUN_UNPUBLISHED'])
    const after = await listAdminActions({ limit: 1 }, __actor)
    expect(after.total).toBeGreaterThanOrEqual(before + 2)
    expect(after.results).toHaveLength(1)
  })

  it('leaves PII_READ rows out unless includeDataAccess is set', async () => {
    const admin = await makeUser('ADMIN')
    const __actor = sess(admin)
    const registrationId = `feed-pii-${crypto.randomUUID()}`
    await recordPiiRead({
      actorId: admin.id,
      route: 'GET /admin/registrations',
      targetType: 'registration',
      targetIds: [registrationId],
      hasQuery: false,
    })
    const mine = (rows: { actorId: string; action: string; targetId: string }[]) =>
      rows.filter((row) => row.actorId === admin.id).map((row) => [row.action, row.targetId])

    expect(mine((await listAdminActions({ limit: 100 }, __actor)).results)).toEqual([])
    expect(mine((await listAdminActions({ limit: 100, includeDataAccess: true }, __actor)).results)).toEqual([
      ['PII_READ', registrationId],
    ])
  })

  it('rejects a STUDENT session', async () => {
    await expect(listAdminActions({}, sess(await makeUser('STUDENT')))).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
