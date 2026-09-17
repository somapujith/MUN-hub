import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users, type MunStatus } from '@/lib/db/schema'
import { runConferenceReminders } from './reminder-job'
import type { NotificationsAdapter } from './adapter'

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

async function makeConfirmedRegistration(opts: {
  startDate: Date
  endDate?: Date | null
  venue?: string | null
  status?: 'CONFIRMED' | 'PENDING'
  munStatus?: MunStatus
}) {
  const organizer = (
    await db.insert(users).values({ name: 'Org', email: `org-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' }).returning()
  )[0]
  const delegate = (
    await db.insert(users).values({ name: 'Delegate', email: `del-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
  )[0]
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId: organizer.id,
      name: 'Reminder Test Mun',
      slug: `reminder-test-${crypto.randomUUID()}`,
      startDate: opts.startDate,
      endDate: opts.endDate ?? opts.startDate,
      venue: opts.venue ?? null,
      status: opts.munStatus ?? 'REGISTRATION_CLOSED',
    })
    .returning()
  const [product] = await db.insert(registrationProducts).values({ munId: mun.id, name: 'Standard', price: 1000, capacity: 20 }).returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId: delegate.id, munId: mun.id, registrationProductId: product.id, status: opts.status ?? 'CONFIRMED' })
    .returning()
  return { organizer, delegate, mun, registration }
}

const HOUR = 60 * 60 * 1000

describe('runConferenceReminders', () => {
  it('emails a CONFIRMED delegate whose mun starts in exactly 24h', async () => {
    const now = new Date()
    const { delegate, mun, registration } = await makeConfirmedRegistration({
      startDate: new Date(now.getTime() + 24 * HOUR),
      venue: 'Grand Hall',
    })
    const { adapter, send } = mockAdapter()

    const result = await runConferenceReminders(now, adapter)

    expect(result.sent).toBeGreaterThanOrEqual(1)
    const call = send.mock.calls.find((c) => c[0].to === delegate.email)
    expect(call).toBeDefined()
    expect(call?.[0].subject).toContain(mun.name)
    expect(call?.[0].body).toContain('Grand Hall')
    expect(call?.[0].body).toContain(`/dashboard/registrations/${registration.id}/pass`)
    expect(call?.[0].body).toContain(mun.slug)
  })

  it('does not email a delegate whose mun starts in 48h (outside the window)', async () => {
    const now = new Date()
    const { delegate } = await makeConfirmedRegistration({ startDate: new Date(now.getTime() + 48 * HOUR) })
    const { adapter, send } = mockAdapter()

    await runConferenceReminders(now, adapter)

    expect(send.mock.calls.some((c) => c[0].to === delegate.email)).toBe(false)
  })

  it('does not email a delegate whose mun already started', async () => {
    const now = new Date()
    const { delegate } = await makeConfirmedRegistration({ startDate: new Date(now.getTime() - HOUR) })
    const { adapter, send } = mockAdapter()

    await runConferenceReminders(now, adapter)

    expect(send.mock.calls.some((c) => c[0].to === delegate.email)).toBe(false)
  })

  it('does not email a PENDING (unconfirmed) registration even inside the window', async () => {
    const now = new Date()
    const { delegate } = await makeConfirmedRegistration({ startDate: new Date(now.getTime() + 24 * HOUR), status: 'PENDING' })
    const { adapter, send } = mockAdapter()

    await runConferenceReminders(now, adapter)

    expect(send.mock.calls.some((c) => c[0].to === delegate.email)).toBe(false)
  })

  it.each(['PUBLISHED', 'REGISTRATION_OPEN', 'CONFERENCE_ACTIVE'] as const)(
    'emails a CONFIRMED delegate of a %s mun inside the window',
    async (munStatus) => {
      const now = new Date()
      const { delegate } = await makeConfirmedRegistration({ startDate: new Date(now.getTime() + 24 * HOUR), munStatus })
      const { adapter, send } = mockAdapter()

      await runConferenceReminders(now, adapter)

      expect(send.mock.calls.some((c) => c[0].to === delegate.email)).toBe(true)
    },
  )

  // Cancelling keeps CONFIRMED registrations (no refunds), so the mun status is
  // the only thing that stops a "see you there" for a conference that isn't happening.
  it.each(['CANCELLED', 'SUSPENDED', 'UNPUBLISHED', 'VERIFICATION', 'DRAFT'] as const)(
    'does not email a CONFIRMED delegate of a %s mun inside the window',
    async (munStatus) => {
      const now = new Date()
      const { delegate } = await makeConfirmedRegistration({ startDate: new Date(now.getTime() + 24 * HOUR), munStatus })
      const { adapter, send } = mockAdapter()

      await runConferenceReminders(now, adapter)

      expect(send.mock.calls.some((c) => c[0].to === delegate.email)).toBe(false)
    },
  )

  it('does not re-notify on a later run once the 5-minute window has passed', async () => {
    const now = new Date()
    const { delegate } = await makeConfirmedRegistration({ startDate: new Date(now.getTime() + 24 * HOUR) })
    const { adapter } = mockAdapter()
    await runConferenceReminders(now, adapter)

    const { adapter: adapter2, send: send2 } = mockAdapter()
    await runConferenceReminders(new Date(now.getTime() + 10 * 60 * 1000), adapter2) // 10 min later — outside the 5-min window

    expect(send2.mock.calls.some((c) => c[0].to === delegate.email)).toBe(false)
  })
})
