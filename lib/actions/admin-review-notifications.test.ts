import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'

// -----------------------------------------------------------------------------
// Gate-1 decision notification wiring for reviewMunApplication (admin-review.ts) —
// same dedicated-file precedent as lib/lifecycle/go-live-notifications.test.ts
// (Task 12 Step 5): spies on both notification surfaces via vi.mock and proves
// the right one fires for each decision.
// -----------------------------------------------------------------------------

const notifyOrganizerApplicationEventMock = vi.fn().mockResolvedValue(undefined)
const notifyPipelineEventMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/notifications/organizer-application-events', () => ({
  notifyOrganizerApplicationEvent: (...args: unknown[]) => notifyOrganizerApplicationEventMock(...args),
}))
vi.mock('@/lib/notifications/pipeline-events', () => ({
  notifyPipelineEvent: (...args: unknown[]) => notifyPipelineEventMock(...args),
}))

const { reviewMunApplication } = await import('./admin-review')

async function makeUser(role: 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: 'SUBMITTED' | 'UNDER_REVIEW') {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Gate 1 Notify Mun', slug: `gate1-notify-${crypto.randomUUID()}`, status })
    .returning()
  await db.insert(organizerApplications).values({ organizerId, munId: mun.id, status: 'SUBMITTED' })
  return mun
}

function sess(user: { id: string; role: Session['role'] }): Session {
  return { userId: user.id, role: user.role }
}

async function waitForCalls(mock: ReturnType<typeof vi.fn>, minCalls: number, timeoutMs = 300): Promise<void> {
  const baseline = mock.mock.calls.length
  const deadline = Date.now() + timeoutMs
  while (mock.mock.calls.length - baseline < minCalls && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('reviewMunApplication Gate-1 decision notification wiring', () => {
  afterEach(() => {
    notifyOrganizerApplicationEventMock.mockClear()
    notifyPipelineEventMock.mockClear()
  })

  it('APPROVED fires APPLICATION_APPROVED and ONBOARDING_STARTED after commit', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')

    const result = await reviewMunApplication(mun.id, 'APPROVED', 'looks good', undefined, sess(admin))
    expect(result.status).toBe('ONBOARDING')

    await waitForCalls(notifyOrganizerApplicationEventMock, 1)
    await waitForCalls(notifyPipelineEventMock, 1)

    expect(notifyOrganizerApplicationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPLICATION_APPROVED', munId: mun.id }),
    )
    expect(notifyPipelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ONBOARDING_STARTED', munId: mun.id }),
    )
  })

  it('CHANGES_REQUESTED fires APPLICATION_CHANGES_REQUESTED with the notes as reason, and never ONBOARDING_STARTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'UNDER_REVIEW')

    await reviewMunApplication(mun.id, 'CHANGES_REQUESTED', 'Fix the venue address', undefined, sess(admin))

    await waitForCalls(notifyOrganizerApplicationEventMock, 1)

    expect(notifyOrganizerApplicationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPLICATION_CHANGES_REQUESTED', munId: mun.id, reason: 'Fix the venue address' }),
    )
    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })

  it('REJECTED fires APPLICATION_REJECTED with the notes as reason, and never ONBOARDING_STARTED', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id, 'SUBMITTED')

    await reviewMunApplication(mun.id, 'REJECTED', 'Fabricated committee list', undefined, sess(admin))

    await waitForCalls(notifyOrganizerApplicationEventMock, 1)

    expect(notifyOrganizerApplicationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPLICATION_REJECTED', munId: mun.id, reason: 'Fabricated committee list' }),
    )
    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await db.$client.end()
})
