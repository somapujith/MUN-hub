import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import { runOrganizerDigest } from './organizer-digest-job'
import type { NotificationsAdapter } from './adapter'

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

/** 09:02 IST today — inside the digest window (09:00–09:05 IST). */
function digestWindowNow(): Date {
  const now = new Date()
  const istParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = istParts.find((p) => p.type === 'year')?.value
  const month = istParts.find((p) => p.type === 'month')?.value
  const day = istParts.find((p) => p.type === 'day')?.value
  // 09:02 IST = 03:32 UTC.
  return new Date(`${year}-${month}-${day}T03:32:00Z`)
}

async function makeOpenMunWithProduct(opts: { capacity: number; confirmedCount: number; recentConfirmedCount?: number }) {
  const organizer = (
    await db.insert(users).values({ name: 'Digest Org', email: `digest-org-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' }).returning()
  )[0]
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Digest Test Mun', slug: `digest-test-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Standard', price: 1000, capacity: opts.capacity, status: 'active' })
    .returning()

  const now = new Date()
  const recentCount = opts.recentConfirmedCount ?? 0
  for (let i = 0; i < opts.confirmedCount; i++) {
    const delegate = (
      await db.insert(users).values({ name: `D${i}`, email: `digest-delegate-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' }).returning()
    )[0]
    const isRecent = i < recentCount
    const [reg] = await db
      .insert(registrations)
      .values({ userId: delegate.id, munId: mun.id, registrationProductId: product.id, status: 'CONFIRMED' })
      .returning()
    if (!isRecent) {
      // Push updatedAt outside the 24h window for the "not recent" ones.
      await db
        .update(registrations)
        .set({ updatedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000) })
        .where(eq(registrations.id, reg.id))
    }
  }

  return { organizer, mun, product }
}

describe('runOrganizerDigest', () => {
  it('is a no-op outside the 09:00-09:05 IST window', async () => {
    const outsideWindow = new Date('2026-01-01T00:00:00Z') // 05:30 IST — not the window
    const { adapter, send } = mockAdapter()

    const result = await runOrganizerDigest(outsideWindow, adapter)

    expect(result.sent).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('emails the organizer with seats-left and a recent-confirmations count inside the window', async () => {
    const { organizer, mun } = await makeOpenMunWithProduct({ capacity: 20, confirmedCount: 5, recentConfirmedCount: 2 })
    const { adapter, send } = mockAdapter()

    const result = await runOrganizerDigest(digestWindowNow(), adapter)

    expect(result.sent).toBeGreaterThanOrEqual(1)
    const call = send.mock.calls.find((c) => c[0].to === organizer.email)
    expect(call).toBeDefined()
    expect(call?.[0].body).toContain(mun.name)
    expect(call?.[0].body).toContain('2 new confirmed registrations')
    expect(call?.[0].body).toContain('15 seats left (of 20)')
  })

  it('calls out a sold-out pass', async () => {
    const { organizer } = await makeOpenMunWithProduct({ capacity: 3, confirmedCount: 3 })
    const { adapter, send } = mockAdapter()

    await runOrganizerDigest(digestWindowNow(), adapter)

    const call = send.mock.calls.find((c) => c[0].to === organizer.email)
    expect(call?.[0].body).toContain('SOLD OUT')
  })

  it('does not email an organizer with no REGISTRATION_OPEN mun', async () => {
    const organizer = (
      await db.insert(users).values({ name: 'No Open Mun', email: `no-open-${crypto.randomUUID()}@test.dev`, role: 'ORGANIZER' }).returning()
    )[0]
    await db.insert(muns).values({ organizerId: organizer.id, name: 'Draft Mun', slug: `draft-${crypto.randomUUID()}`, status: 'DRAFT' })

    const { adapter, send } = mockAdapter()
    await runOrganizerDigest(digestWindowNow(), adapter)

    expect(send.mock.calls.some((c) => c[0].to === organizer.email)).toBe(false)
  })
})
