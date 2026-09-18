import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munSubmissions, users, type MunStatus } from '@/lib/db/schema'

const { runSlaNotifications } = await import('./sla-job')

// Real wall-clock time, not a fabricated far-future date: runSlaNotifications
// scans the WHOLE mun_submissions table (it's a batch job, not scoped to a
// caller's own rows), and this test DB is shared with every other lane's
// concurrent test run. A fixed date days ahead of "now" would mark other
// sessions' legitimately-still-on-track fixtures as false OVERDUE. Using the
// real clock means only rows whose deadline has genuinely already passed are
// ever touched — correct behavior, not test-order-dependent corruption.
const NOW = new Date()

async function makeSubmission(
  overrides: Partial<typeof munSubmissions.$inferInsert> = {},
  munStatus: MunStatus = 'VERIFICATION',
) {
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Org', email: `org-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'SLA Test Mun', slug: `sla-test-${crypto.randomUUID()}`, status: munStatus })
    .returning()
  const [submission] = await db
    .insert(munSubmissions)
    .values({
      munId: mun.id,
      submittedBy: organizer.id,
      versionNumber: 1,
      status: 'SUBMITTED',
      slaState: 'ON_TRACK',
      slaDeadline: new Date(NOW.getTime() + 24 * 60 * 60 * 1000), // 1 day out by default
      submittedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      slaPausedTotalMs: 0,
      ...overrides,
    })
    .returning()
  return { organizer, mun, submission }
}

describe('runSlaNotifications', () => {
  it('does not send any emails — the SLA delay notification was removed', async () => {
    const result = await runSlaNotifications(NOW)
    expect(result).toEqual({ sent: 0 })
  })

  it('updates slaState to OVERDUE for a submission whose deadline has passed', async () => {
    const { submission } = await makeSubmission({
      slaDeadline: new Date(NOW.getTime() - 1000), // already past
    })

    const result = await runSlaNotifications(NOW)
    expect(result).toEqual({ sent: 0 })

    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('OVERDUE')
  })

  it('updates slaState to DUE_SOON for a submission close to its deadline', async () => {
    const submittedAt = new Date(NOW.getTime() - 22 * 60 * 60 * 1000) // 22h ago
    const { submission } = await makeSubmission({
      submittedAt,
      slaDeadline: new Date(NOW.getTime() + 60 * 60 * 1000), // 1h remaining of a 23h window — well under 25%
    })

    await runSlaNotifications(NOW)

    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('DUE_SOON')
  })

  it('leaves slaState alone for a submission that is comfortably ON_TRACK', async () => {
    const { submission } = await makeSubmission({
      slaDeadline: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    })

    await runSlaNotifications(NOW)

    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('ON_TRACK')
  })

  // The submission row (and its clock) exists from the moment automated
  // checks pass, but review can't start until the organizer confirms —
  // the stored state still tracks the clock regardless of mun status.
  it('still tracks the clock for a submission MUN Hub has not started reviewing yet', async () => {
    const { submission } = await makeSubmission(
      { status: 'SUBMITTED', slaDeadline: new Date(NOW.getTime() - 1000) },
      'ORGANIZER_CONFIRMATION',
    )

    await runSlaNotifications(NOW)

    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('OVERDUE')
  })

  it('never touches a terminal (PUBLISHED) submission, even with a long-past deadline', async () => {
    const { submission } = await makeSubmission({
      status: 'PUBLISHED',
      slaState: 'COMPLETED',
      slaDeadline: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
    })

    await runSlaNotifications(NOW)

    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('COMPLETED')
  })
})

afterAll(async () => {
  await db.$client.end()
})
