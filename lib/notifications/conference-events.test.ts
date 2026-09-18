import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
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
  it('emails every CONFIRMED delegate and the organizer when an admin cancelled', async () => {
    const { organizer, mun, confirmedDelegate1, confirmedDelegate2, pendingDelegate } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: 'Venue fell through' })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, { adapter })

    const recipients = send.mock.calls.map((call) => call[0].to)
    expect(recipients).toContain(confirmedDelegate1.email)
    expect(recipients).toContain(confirmedDelegate2.email)
    expect(recipients).toContain(organizer.email)
    // Not passed in `justCancelledRegistrationIds`, so this PENDING delegate
    // isn't treated as "just cancelled by this action" — see the dedicated
    // test below for that case.
    expect(recipients).not.toContain(pendingDelegate.email)
    expect(send).toHaveBeenCalledTimes(3)

    const organizerCall = send.mock.calls.find((call) => call[0].to === organizer.email)
    expect(organizerCall?.[0].subject).toContain(mun.name)
    expect(organizerCall?.[0].body).toContain('The MUN Hub team made this decision.')
  })

  // docs/review-to-claude.md item #12: before this, a delegate whose
  // PENDING/PAYMENT_PENDING registration got swept to CANCELLED by the same
  // cancellation got no email at all — only already-CONFIRMED delegates did.
  it('also emails a delegate whose in-flight registration this cancellation just swept to CANCELLED, with honest copy', async () => {
    const { mun, confirmedDelegate1, pendingDelegate } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: 'Venue fell through' })

    const [pendingRegistration] = await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(eq(registrations.userId, pendingDelegate.id))

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, { adapter, justCancelledRegistrationIds: [pendingRegistration.id] })

    const pendingCall = send.mock.calls.find((call) => call[0].to === pendingDelegate.email)
    expect(pendingCall).toBeDefined()
    expect(pendingCall?.[0].body).toContain("hadn't been confirmed yet")
    expect(pendingCall?.[0].body.toLowerCase()).not.toContain('payments for this conference are final')

    // A CONFIRMED delegate in the same cancellation still gets the original,
    // no-refunds copy — the distinction is per-recipient, not per-mun.
    const confirmedCall = send.mock.calls.find((call) => call[0].to === confirmedDelegate1.email)
    expect(confirmedCall?.[0].body.toLowerCase()).toContain('payments for this conference are final')
  })

  // The admin cancel dialog records the reason as an internal audit note, so
  // it can hold findings (fraud, failed KYC) that must never reach delegates
  // or the organizer, and it must never be credited to the organizer.
  it("never emails an admin's cancel reason, to delegates or to the organizer", async () => {
    const { organizer, mun, confirmedDelegate1 } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    const internalNote = 'Organizer failed bank verification — suspected fraudulent account'
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: internalNote })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, { adapter })

    expect(send.mock.calls.map((call) => call[0].to)).toEqual(expect.arrayContaining([confirmedDelegate1.email, organizer.email]))
    for (const [payload] of send.mock.calls) {
      expect(payload.body).not.toContain(internalNote)
      expect(payload.body).not.toContain('The organizer gave this reason')
    }
  })

  it("quotes the organizer's own reason to delegates and does not notify the organizer", async () => {
    const { organizer, mun, confirmedDelegate1 } = await makeMunWithRegistrations()
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: organizer.id, action: 'CANCELLED', notes: 'Changed plans' })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, { adapter })

    const recipients = send.mock.calls.map((call) => call[0].to)
    expect(recipients).not.toContain(organizer.email)
    const delegateCall = send.mock.calls.find((call) => call[0].to === confirmedDelegate1.email)
    expect(delegateCall?.[0].body).toContain('The organizer gave this reason: Changed plans.')
  })

  it('never promises a refund — only "payments are final" and a link to /legal/refunds', async () => {
    const { mun } = await makeMunWithRegistrations()
    const admin = await makeUser('ADMIN', 'Admin')
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: admin.id, action: 'CANCELLED', notes: null })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, { adapter })

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

  it('omits the reason line when the organizer recorded no reason', async () => {
    const { organizer, mun } = await makeMunWithRegistrations()
    await db.insert(verificationLogs).values({ munId: mun.id, reviewerId: organizer.id, action: 'CANCELLED', notes: '   ' })

    const { adapter, send } = mockAdapter()
    await notifyConferenceCancelled(mun.id, { adapter })

    const bodies = send.mock.calls.map((call) => call[0].body as string)
    for (const body of bodies) {
      expect(body).not.toContain('reason')
    }
  })

  it('throws for a mun id that does not resolve', async () => {
    const { adapter } = mockAdapter()
    await expect(notifyConferenceCancelled('00000000-0000-0000-0000-000000000000', { adapter })).rejects.toThrow(
      'Mun not found',
    )
  })
})
