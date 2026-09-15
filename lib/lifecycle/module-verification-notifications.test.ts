import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, munModuleVerifications } from '@/lib/db/schema'

// -----------------------------------------------------------------------------
// Task 12 Step 5 — notification-wiring proof for module-verification.ts.
//
// A dedicated file (parallel to go-live-notifications.test.ts) proving
// reviewModule's CHANGES_REQUESTED decision actually calls
// notifyPipelineEvent with a MODULE_ACTION_REQUIRED event, after the review
// transaction commits.
// -----------------------------------------------------------------------------

const notifyPipelineEventMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/notifications/pipeline-events', () => ({
  notifyPipelineEvent: (...args: unknown[]) => notifyPipelineEventMock(...args),
}))

const { reviewModule } = await import('./module-verification')

async function makeUser(role: 'ORGANIZER' | 'ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Notify Module Mun', slug: `notify-module-mun-${crypto.randomUUID()}`, status: 'VERIFICATION' })
    .returning()
  return mun
}

/** Fire-and-forget notifications resolve after the review transaction commits. */
async function waitForNotifications() {
  for (let i = 0; i < 50; i++) {
    if (notifyPipelineEventMock.mock.calls.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('module-verification.ts pipeline notification wiring', () => {
  afterEach(() => {
    notifyPipelineEventMock.mockClear()
  })

  it('reviewModule CHANGES_REQUESTED fires MODULE_ACTION_REQUIRED with the issue reasons', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'COMMITTEES', state: 'PENDING_REVIEW' })

    await reviewModule(
      mun.id,
      'COMMITTEES',
      'CHANGES_REQUESTED',
      [{ severity: 'HIGH', reason: 'Capacity looks implausibly high' }],
      { userId: admin.id, role: 'ADMIN' },
    )

    await waitForNotifications()

    expect(notifyPipelineEventMock).toHaveBeenCalledTimes(1)
    expect(notifyPipelineEventMock.mock.calls[0][0]).toMatchObject({
      type: 'MODULE_ACTION_REQUIRED',
      munId: mun.id,
      moduleName: 'COMMITTEES',
      issues: ['Capacity looks implausibly high'],
    })
  })

  it('reviewModule VERIFIED does NOT fire a notification', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'COMMITTEES', state: 'PENDING_REVIEW' })

    await reviewModule(mun.id, 'COMMITTEES', 'VERIFIED', [], { userId: admin.id, role: 'ADMIN' })

    await waitForNotifications()

    expect(notifyPipelineEventMock).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await db.$client.end()
})
