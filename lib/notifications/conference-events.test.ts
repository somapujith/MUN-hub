import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users, verificationLogs } from '@/lib/db/schema'
import { notifyConferenceCancelled } from './conference-events'
import type { NotificationsAdapter } from './adapter'

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN', name: string) {
  const [user] = await db.insert(users).values({ name, email: `${name.toLowerCase()}-${crypto.randomUUID()}@test.dev`, role }).returning()
  return user
}

async function makeMunWithRegistrations() {
  const organizer = await makeUser('ORGANIZER', 'Organizer')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Cancelled Test Mun', slug: `cancel-test-${crypto.randomUUID()}` })
    .returning()
  const [product] = await db.insert(registrationProducts).values({ munId: mun.id, name: 'Standard', price: 1000, capacity: 20 }).returning()

  const confirmedDelegate1 = await makeUser('STUDENT', 'Delegate One')
  const confirmedDelegate2 = await makeUser('STUDENT', 'Delegate Two')
  const pendingDelegate = await makeUser('STUDENT', 'Pending Delegate')

  await db.insert(registrations).values([
    { userId: confirmedDelegate1.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' },
    { userId: confirmedDelegate2.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' },
    { userId: pendingDelegate.id, munId: mun.id, registrationProductId: product.id, status: 'PENDING' },
  ])

  return { organizer, mun, confirmedDelegate1, confirmedDelegate2, pendingDelegate }
}

describe('notifyConferenceCancelled', () => {
  it('emails every CONFIRMED delegate and the organizer when an admin cancelled, with the reason', async () => {
    const { organizer, mun, confirmedDelegate1, confirmedDelegate2, pendingDelegate } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: 'Venue fell through' })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, adapter)

    const recipients = send.mock.calls.map((call) => call[0].to)
    expect(recipients).toContain(confirmedDelegate1.email)
    expect(recipients).toContain(confirmedDelegate2.email)
    expect(recipients).toContain(organizer.email)
    expect(recipients).not.toContain(pendingDelegate.email)
    expect(send).toHaveBeenCalledTimes(3)

    const organizerCall = send.mock.calls.find((call) => call[0].to === organizer.email)
    expect(organizerCall?.[0].subject).toContain(mun.name)
    expect(organizerCall?.[0].body).toContain('Venue fell through')
  })

  it('does not notify the organizer when the organizer cancelled it themselves', async () => {
    const { organizer, mun } = await makeMunWithRegistrations()
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: organizer.id, action: 'CANCELLED', notes: 'Changed plans' })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, adapter)

    const recipients = send.mock.calls.map((call) => call[0].to)
    expect(recipients).not.toContain(organizer.email)
  })

  it('never promises a refund — only "payments are final" and a link to /legal/refunds', async () => {
    const { mun } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: null })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, adapter)

    const bodies = send.mock.calls.map((call) => call[0].body as string)
    for (const body of bodies) {
      // The required /legal/refunds link necessarily contains the word
      // "refund" — what must never appear is a promise of one (e.g. "you
      // will be refunded"), so assert on the absence of that phrasing
      // specifically, not the substring.
      expect(body.toLowerCase()).not.toContain('will be refunded')
      expect(body.toLowerCase()).not.toContain('you will receive a refund')
      expect(body.toLowerCase()).toContain('payments for this conference are final')
      expect(body).toContain('/legal/refunds')
    }
  })

  it('omits the reason line when no reason was recorded', async () => {
    const { mun } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: null })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, adapter)

    const bodies = send.mock.calls.map((call) => call[0].body as string)
    for (const body of bodies) {
      expect(body).not.toContain('reason')
    }
  })

  it('throws for a mun id that does not resolve', async () => {
    const { adapter } = mockAdapter()
    await expect(notifyConferenceCancelled('00000000-0000-0000-0000-000000000000', adapter)).rejects.toThrow('Mun not found')
  })
})
