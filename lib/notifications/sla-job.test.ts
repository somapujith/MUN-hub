import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, munSubmissions, users, type MunStatus } from '@/lib/db/schema'

const notifyPipelineEventMock = vi.fn().mockResolvedValue(undefined)

vi.mock('./pipeline-events', () => ({
  notifyPipelineEvent: (...args: unknown[]) => notifyPipelineEventMock(...args),
}))

const { runSlaNotifications } = await import('./sla-job')

// Real wall-clock time, not a fabricated far-future date: runSlaNotifications
// scans the WHOLE mun_submissions table (it's a batch job, not scoped to a
// caller's own rows), and this test DB is shared with every other lane's
// concurrent test run. A fixed date days ahead of "now" would mark other
// sessions' legitimately-still-on-track fixtures as false OVERDUE. Using the
// real clock means only rows whose deadline has genuinely already passed are
// ever touched — correct behavior, not test-order-dependent corruption.
const NOW = new Date()

// Defaults to a mun under MUN Hub's review (VERIFICATION), the only state in
// which SLA_DELAY is sent.
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
  afterEach(() => {
    notifyPipelineEventMock.mockClear()
  })

  it('sends SLA_DELAY and updates slaState for a submission that just went OVERDUE', async () => {
    const { mun, submission } = await makeSubmission({
      slaDeadline: new Date(NOW.getTime() - 1000), // already past
    })

    const result = await runSlaNotifications(NOW)

    expect(result.sent).toBeGreaterThanOrEqual(1)
    expect(notifyPipelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SLA_DELAY', munId: mun.id }),
    )

    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('OVERDUE')
  })

  it('does not re-notify on a second run once slaState already reflects OVERDUE', async () => {
    const { submission } = await makeSubmission({
      slaDeadline: new Date(NOW.getTime() - 1000),
    })

    await runSlaNotifications(NOW)
    notifyPipelineEventMock.mockClear()

    const secondRun = await runSlaNotifications(new Date(NOW.getTime() + 60_000))

    const calledForThisSubmission = notifyPipelineEventMock.mock.calls.some(
      (call) => (call[0] as { munId: string }).munId === submission.munId,
    )
    expect(calledForThisSubmission).toBe(false)
    expect(secondRun.sent).toBe(0)
  })

  it('sends SLA_DELAY for a submission that crosses into DUE_SOON (not yet overdue)', async () => {
    const submittedAt = new Date(NOW.getTime() - 22 * 60 * 60 * 1000) // 22h ago
    const { mun } = await makeSubmission({
      submittedAt,
      slaDeadline: new Date(NOW.getTime() + 60 * 60 * 1000), // 1h remaining of a 23h window — well under 25%
    })

    const result = await runSlaNotifications(NOW)

    expect(result.sent).toBeGreaterThanOrEqual(1)
    expect(notifyPipelineEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'SLA_DELAY', munId: mun.id }))
  })

  it('does not notify a submission that is comfortably ON_TRACK', async () => {
    const { submission } = await makeSubmission({
      slaDeadline: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    })

    await runSlaNotifications(NOW)

    const calledForThisSubmission = notifyPipelineEventMock.mock.calls.some(
      (call) => (call[0] as { munId: string }).munId === submission.munId,
    )
    expect(calledForThisSubmission).toBe(false)
  })

  it('sends SLA_DELAY for an overdue submission a reviewer has picked up (UNDER_REVIEW)', async () => {
    const { mun } = await makeSubmission({ status: 'UNDER_REVIEW', slaDeadline: new Date(NOW.getTime() - 1000) })

    await runSlaNotifications(NOW)

    expect(notifyPipelineEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'SLA_DELAY', munId: mun.id }))
  })

  // The submission row (and its clock) exists from the moment automated checks
  // pass, but review can't start until the organizer confirms.
  it('does not tell the organizer review is delayed while MUN Hub waits on their confirmation', async () => {
    const { mun, submission } = await makeSubmission(
      { status: 'SUBMITTED', slaDeadline: new Date(NOW.getTime() - 1000) },
      'ORGANIZER_CONFIRMATION',
    )

    await runSlaNotifications(NOW)

    const calledForThisMun = notifyPipelineEventMock.mock.calls.some((call) => (call[0] as { munId: string }).munId === mun.id)
    expect(calledForThisMun).toBe(false)
    // The stored state still tracks the clock.
    const [updated] = await db.select({ slaState: munSubmissions.slaState }).from(munSubmissions).where(eq(munSubmissions.id, submission.id))
    expect(updated.slaState).toBe('OVERDUE')
  })

  it.each([
    ['VERIFIED', 'APPROVED'],
    ['GO_LIVE_QUEUE', 'APPROVED'],
    ['GO_LIVE_QUEUE', 'QUEUED'],
    ['UNPUBLISHED', 'APPROVED'],
  ] as const)('does not send SLA_DELAY once review is decided (mun %s, submission %s)', async (munStatus, status) => {
    const { mun } = await makeSubmission({ status, slaDeadline: new Date(NOW.getTime() - 1000) }, munStatus)

    await runSlaNotifications(NOW)

    const calledForThisMun = notifyPipelineEventMock.mock.calls.some((call) => (call[0] as { munId: string }).munId === mun.id)
    expect(calledForThisMun).toBe(false)
  })

  it('never touches a terminal (PUBLISHED) submission, even with a long-past deadline', async () => {
    const { mun } = await makeSubmission({
      status: 'PUBLISHED',
      slaState: 'COMPLETED',
      slaDeadline: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
    })

    await runSlaNotifications(NOW)

    const calledForThisMun = notifyPipelineEventMock.mock.calls.some((call) => (call[0] as { munId: string }).munId === mun.id)
    expect(calledForThisMun).toBe(false)
  })
})

afterAll(async () => {
  await db.$client.end()
})
