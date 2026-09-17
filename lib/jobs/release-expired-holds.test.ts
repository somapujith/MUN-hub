import { describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/types'
import { releaseExpiredHolds, releaseExpiredHoldsJob } from './release-expired-holds'

// The job is global (every product), and the local database is shared with
// other test files and sessions. To only ever touch this file's rows, the
// fixtures are dated in the year 2000 and the job runs "as of" mid-2000:
// every other hold in the database expires after that, so it can't match.
const AS_OF = new Date('2000-06-01T00:00:00Z')
const EXPIRED = new Date('2000-05-01T00:00:00Z')
const NOT_YET_EXPIRED = new Date('2000-07-01T00:00:00Z')

async function createUser(role: 'STUDENT' | 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: 'Hold Test', email: `hold-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function createProduct() {
  const organizer = await createUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId: organizer.id,
      name: 'Hold Sweep Mun',
      slug: `hold-sweep-${crypto.randomUUID()}`,
      status: 'REGISTRATION_OPEN',
    })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 2500, capacity: 10 })
    .returning()
  return product
}

async function hold(
  product: { id: string; munId: string },
  status: RegistrationStatus,
  expiresAt: Date | null,
): Promise<string> {
  const student = await createUser('STUDENT')
  const [registration] = await db
    .insert(registrations)
    .values({ userId: student.id, munId: product.munId, registrationProductId: product.id, status, expiresAt })
    .returning({ id: registrations.id })
  return registration.id
}

async function statuses(ids: string[]): Promise<Record<string, RegistrationStatus>> {
  const rows = await db
    .select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(inArray(registrations.id, ids))
  return Object.fromEntries(rows.map((row) => [row.id, row.status]))
}

describe('releaseExpiredHolds', () => {
  it('cancels expired PENDING and PAYMENT_PENDING holds across different MUNs', async () => {
    const productA = await createProduct()
    const productB = await createProduct()
    const pendingA = await hold(productA, 'PENDING', EXPIRED)
    const paymentPendingB = await hold(productB, 'PAYMENT_PENDING', EXPIRED)

    const released = await releaseExpiredHolds(AS_OF)

    expect(released).toBeGreaterThanOrEqual(2)
    expect(await statuses([pendingA, paymentPendingB])).toEqual({
      [pendingA]: 'CANCELLED',
      [paymentPendingB]: 'CANCELLED',
    })
  })

  it('leaves unexpired holds, holds without an expiry, and finished registrations alone', async () => {
    const product = await createProduct()
    const notExpired = await hold(product, 'PAYMENT_PENDING', NOT_YET_EXPIRED)
    const noExpiry = await hold(product, 'PENDING', null)
    const confirmed = await hold(product, 'CONFIRMED', EXPIRED)
    const expired = await hold(product, 'PENDING', EXPIRED)

    await releaseExpiredHolds(AS_OF)

    expect(await statuses([notExpired, noExpiry, confirmed, expired])).toEqual({
      [notExpired]: 'PAYMENT_PENDING',
      [noExpiry]: 'PENDING',
      [confirmed]: 'CONFIRMED',
      [expired]: 'CANCELLED',
    })
  })

  it('is idempotent: a second run leaves released holds cancelled', async () => {
    const product = await createProduct()
    const expired = await hold(product, 'PAYMENT_PENDING', EXPIRED)

    await releaseExpiredHolds(AS_OF)
    await releaseExpiredHolds(AS_OF)

    expect(await statuses([expired])).toEqual({ [expired]: 'CANCELLED' })
  })
})

describe('releaseExpiredHoldsJob', () => {
  it('reports how many holds it released', async () => {
    const product = await createProduct()
    const expired = await hold(product, 'PENDING', EXPIRED)

    const result = await releaseExpiredHoldsJob.run({ now: AS_OF })

    expect(result.released).toBeGreaterThanOrEqual(1)
    expect(await statuses([expired])).toEqual({ [expired]: 'CANCELLED' })
  })
})
