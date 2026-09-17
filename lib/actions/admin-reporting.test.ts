import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { PaymentStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import {
  getConversionFunnel,
  getGeographyBreakdown,
  getOrganizerLeaderboard,
  getPlatformFeeSummary,
  getRegistrationTrend,
  getRevenueTrend,
  getSignupTrend,
  getTopConferences,
} from './admin-reporting'

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

const createdUserIds: string[] = []
const createdMunIds: string[] = []

async function makeUser(role: AnyRole, extra: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `reporting ${role}`, email: `reporting-${crypto.randomUUID()}@test.dev`, role, ...extra })
    .returning()
  createdUserIds.push(user.id)
  return user
}

async function makeMun(organizerId: string, extra: Partial<typeof muns.$inferInsert> = {}) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: `Reporting Mun ${crypto.randomUUID()}`,
      slug: `reporting-${crypto.randomUUID()}`,
      status: 'PUBLISHED',
      ...extra,
    })
    .returning()
  createdMunIds.push(mun.id)
  return mun
}

async function makeProduct(munId: string) {
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId, name: 'Delegate', price: 1000, capacity: 500 })
    .returning()
  return product
}

async function makeRegistration(
  munId: string,
  productId: string,
  status: RegistrationStatus,
  createdAt: Date,
) {
  const delegate = await makeUser('STUDENT')
  const [registration] = await db
    .insert(registrations)
    .values({ userId: delegate.id, munId, registrationProductId: productId, status, createdAt })
    .returning()
  return registration
}

async function makePayment(
  registrationId: string,
  status: PaymentStatus,
  createdAt: Date,
  extra: Partial<typeof payments.$inferInsert> = {},
) {
  const [payment] = await db
    .insert(payments)
    .values({
      registrationId,
      providerOrderId: `order_${crypto.randomUUID()}`,
      amount: 1000,
      status,
      createdAt,
      ...extra,
    })
    .returning()
  return payment
}

function sess(user: { id: string; role: AnyRole }): Session {
  return { userId: user.id, role: user.role }
}

/** A far-future window with a random start, so it never collides with the shared dev DB's real/other-test rows. */
function farFutureNow(): Date {
  return new Date(Date.UTC(2160, 0, 1 + Math.floor(Math.random() * 300)))
}

const DAY = 24 * 60 * 60 * 1000

describe('getRegistrationTrend', () => {
  it('zero-fills every day bucket and only counts rows inside the range', async () => {
    const organizer = await makeUser('ORGANIZER')
    const ops = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    const product = await makeProduct(mun.id)
    const now = farFutureNow()

    await makeRegistration(mun.id, product.id, 'PENDING', new Date(now.getTime() - 1 * DAY))
    await makeRegistration(mun.id, product.id, 'CONFIRMED', new Date(now.getTime() - 1 * DAY))
    await makeRegistration(mun.id, product.id, 'CANCELLED', new Date(now.getTime() - 3 * DAY))
    // Outside the 7-day window — must not be counted.
    await makeRegistration(mun.id, product.id, 'CONFIRMED', new Date(now.getTime() - 9 * DAY))

    const trend = await getRegistrationTrend({ days: 7, granularity: 'day' }, sess(ops), now)

    expect(trend).toHaveLength(8) // 7 days back through today, inclusive
    const dayMinus1 = trend.find((point) => point.bucket === new Date(now.getTime() - 1 * DAY).toISOString().slice(0, 10))
    const dayMinus3 = trend.find((point) => point.bucket === new Date(now.getTime() - 3 * DAY).toISOString().slice(0, 10))
    expect(dayMinus1?.value).toBe(2)
    expect(dayMinus3?.value).toBe(1)
    // A bucket with no rows is still present, at 0.
    const dayMinus2 = trend.find((point) => point.bucket === new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10))
    expect(dayMinus2?.value).toBe(0)
  })

  it.each(['STUDENT', 'ORGANIZER'] as const)('refuses a %s session', async (role) => {
    const user = await makeUser(role)
    await expect(getRegistrationTrend({ days: 7, granularity: 'day' }, sess(user))).rejects.toThrow('Forbidden')
  })

  it('refuses no session', async () => {
    await expect(getRegistrationTrend({ days: 7, granularity: 'day' }, null)).rejects.toThrow('Forbidden')
  })
})

describe('getRevenueTrend', () => {
  it('sums gross and net-of-fee per bucket, PAID only, and excludes mock payments when the mock adapter is off', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    const product = await makeProduct(mun.id)
    const now = farFutureNow()
    const today = now

    const reg1 = await makeRegistration(mun.id, product.id, 'CONFIRMED', today)
    await makePayment(reg1.id, 'PAID', today, { amount: 1000, platformFeeAmount: 50, platformFeeTaxAmount: 9, organizerNetAmount: 941 })
    const reg2 = await makeRegistration(mun.id, product.id, 'CONFIRMED', today)
    await makePayment(reg2.id, 'FAILED', today, { amount: 5000 }) // not PAID — excluded

    const savedAdapter = process.env.PAYMENTS_ADAPTER
    const savedEnabled = process.env.MOCK_PAYMENTS_ENABLED
    try {
      // Force getPaymentsAdapter() to null so countedPaymentsFilter() actively
      // excludes mock-provider rows (the default provider on every row above).
      process.env.PAYMENTS_ADAPTER = 'razorpay'
      const trend = await getRevenueTrend({ days: 7, granularity: 'day' }, sess(admin), now)
      const bucket = today.toISOString().slice(0, 10)
      expect(trend.gross.find((p) => p.bucket === bucket)?.value ?? 0).toBe(0)
      expect(trend.net.find((p) => p.bucket === bucket)?.value ?? 0).toBe(0)
    } finally {
      if (savedAdapter === undefined) delete process.env.PAYMENTS_ADAPTER
      else process.env.PAYMENTS_ADAPTER = savedAdapter
      if (savedEnabled === undefined) delete process.env.MOCK_PAYMENTS_ENABLED
      else process.env.MOCK_PAYMENTS_ENABLED = savedEnabled
    }

    // With the mock adapter active (the test-env default), the same rows count.
    const trend = await getRevenueTrend({ days: 7, granularity: 'day' }, sess(admin), now)
    const bucket = today.toISOString().slice(0, 10)
    expect(trend.gross.find((p) => p.bucket === bucket)?.value).toBe(1000)
    expect(trend.net.find((p) => p.bucket === bucket)?.value).toBe(941)
  })
})

describe('getSignupTrend', () => {
  it('splits new organizer and delegate signups by bucket and role', async () => {
    const ops = await makeUser('OPERATIONS')
    const now = farFutureNow()

    await makeUser('ORGANIZER', { createdAt: now })
    await makeUser('ORGANIZER', { createdAt: now })
    await makeUser('STUDENT', { createdAt: now })
    // Out of range.
    await makeUser('ORGANIZER', { createdAt: new Date(now.getTime() - 30 * DAY) })

    const trend = await getSignupTrend({ days: 7, granularity: 'day' }, sess(ops), now)
    const bucket = now.toISOString().slice(0, 10)
    expect(trend.organizers.find((p) => p.bucket === bucket)?.value).toBe(2)
    expect(trend.delegates.find((p) => p.bucket === bucket)?.value).toBe(1)
  })
})

describe('getConversionFunnel', () => {
  it('computes registration and payment funnels with correct rates', async () => {
    const organizer = await makeUser('ORGANIZER')
    const ops = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    const product = await makeProduct(mun.id)
    const now = farFutureNow()

    await makeRegistration(mun.id, product.id, 'PENDING', now)
    await makeRegistration(mun.id, product.id, 'CONFIRMED', now)
    await makeRegistration(mun.id, product.id, 'ATTENDED', now)
    await makeRegistration(mun.id, product.id, 'CANCELLED', now)
    // Outside range — must not be counted.
    await makeRegistration(mun.id, product.id, 'CONFIRMED', new Date(now.getTime() - 60 * DAY))

    const paidReg = await makeRegistration(mun.id, product.id, 'CONFIRMED', now)
    await makePayment(paidReg.id, 'PAID', now)
    const failedReg = await makeRegistration(mun.id, product.id, 'CANCELLED', now)
    await makePayment(failedReg.id, 'FAILED', now)
    const exceptionReg = await makeRegistration(mun.id, product.id, 'CANCELLED', now)
    await makePayment(exceptionReg.id, 'PAID', now, { exceptionReason: 'late payment', exceptionRaisedAt: now })

    const funnel = await getConversionFunnel({ days: 7 }, sess(ops), now)

    // In-range: PENDING, CONFIRMED, ATTENDED, CANCELLED, paidReg (CONFIRMED),
    // failedReg (CANCELLED), exceptionReg (CANCELLED) = 7. The 60-day-old
    // CONFIRMED row is out of range and must not be counted.
    expect(funnel.registrations.started).toBe(7)
    expect(funnel.registrations.confirmed).toBe(3) // CONFIRMED + ATTENDED + paidReg
    expect(funnel.registrations.cancelled).toBe(3) // CANCELLED + failedReg + exceptionReg
    expect(funnel.registrations.conversionRate).toBeCloseTo(3 / 7)

    expect(funnel.payments.totalPayments).toBe(3)
    expect(funnel.payments.paid).toBe(2)
    expect(funnel.payments.failed).toBe(1)
    expect(funnel.payments.successRate).toBeCloseTo(2 / 3)
    expect(funnel.payments.exceptionsOpened).toBe(1)
    expect(funnel.payments.exceptionRate).toBeCloseTo(1 / 3)
  })

  it('returns zero rates rather than dividing by zero when nothing happened', async () => {
    const ops = await makeUser('OPERATIONS')
    // A window guaranteed to have zero rows of any kind.
    const now = new Date(Date.UTC(2170, 0, 1 + Math.floor(Math.random() * 300)))
    const funnel = await getConversionFunnel({ days: 7 }, sess(ops), now)
    expect(funnel.registrations.started).toBe(0)
    expect(funnel.registrations.conversionRate).toBe(0)
    expect(funnel.payments.successRate).toBe(0)
    expect(funnel.payments.exceptionRate).toBe(0)
  })
})

describe('getTopConferences', () => {
  it('ranks by registration count and by revenue independently, scoped to the range', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const now = farFutureNow()

    const popular = await makeMun(organizer.id, { name: `Popular ${crypto.randomUUID()}` })
    const popularProduct = await makeProduct(popular.id)
    for (let i = 0; i < 3; i++) {
      await makeRegistration(popular.id, popularProduct.id, 'CONFIRMED', now)
    }

    const lucrative = await makeMun(organizer.id, { name: `Lucrative ${crypto.randomUUID()}` })
    const lucrativeProduct = await makeProduct(lucrative.id)
    const reg = await makeRegistration(lucrative.id, lucrativeProduct.id, 'CONFIRMED', now)
    await makePayment(reg.id, 'PAID', now, { amount: 50_000 })

    const top = await getTopConferences({ days: 7 }, sess(admin), now)

    const popularEntry = top.byRegistrations.find((row) => row.munId === popular.id)
    expect(popularEntry?.value).toBe(3)
    const lucrativeEntry = top.byRevenue.find((row) => row.munId === lucrative.id)
    expect(lucrativeEntry?.value).toBe(50_000)
    // The registration-heavy mun sold nothing, so it shouldn't out-earn the paid one.
    expect(top.byRevenue.find((row) => row.munId === popular.id)).toBeUndefined()
  })
})

describe('getOrganizerLeaderboard', () => {
  it('counts conferences ever published (lifetime) and revenue within the range separately', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const now = farFutureNow()

    // `byConferencesPublished` is lifetime, not scoped to `now`, so — unlike
    // every other query here — it isn't naturally isolated from whatever the
    // shared local dev DB has accumulated from other test runs (CLAUDE.md
    // documents this DB as never cleaned). Read the current #1 first and
    // out-publish it by one, so this organizer is deterministically top of
    // the (limit-10) list regardless of pre-existing rows.
    const baseline = await getOrganizerLeaderboard({ days: 7 }, sess(admin), now)
    const currentMax = Math.max(0, ...baseline.byConferencesPublished.map((row) => row.value))
    const publishedStatuses = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'COMPLETED'] as const
    const targetCount = currentMax + 1
    for (let i = 0; i < targetCount; i++) {
      await makeMun(organizer.id, { status: publishedStatuses[i % publishedStatuses.length] })
    }
    await makeMun(organizer.id, { status: 'DRAFT' }) // never published — must not count

    const revenueMun = await makeMun(organizer.id, { status: 'REGISTRATION_OPEN' })
    const product = await makeProduct(revenueMun.id)
    const reg = await makeRegistration(revenueMun.id, product.id, 'CONFIRMED', now)
    await makePayment(reg.id, 'PAID', now, { amount: 7_500 })

    const leaderboard = await getOrganizerLeaderboard({ days: 7 }, sess(admin), now)

    // `revenueMun` is also "ever published" (REGISTRATION_OPEN), so the
    // lifetime count includes it: targetCount muns from the loop + this one.
    expect(leaderboard.byConferencesPublished[0]).toMatchObject({ organizerId: organizer.id, value: targetCount + 1 })
    const revenueEntry = leaderboard.byRevenue.find((row) => row.organizerId === organizer.id)
    expect(revenueEntry?.value).toBe(7_500)
  })
})

describe('getGeographyBreakdown', () => {
  it('groups registrations and revenue by city, only counting revenue-eligible PAID payments', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const now = farFutureNow()
    const city = `Geo City ${crypto.randomUUID()}`

    const mun = await makeMun(organizer.id, { city, country: 'India' })
    const product = await makeProduct(mun.id)
    const reg1 = await makeRegistration(mun.id, product.id, 'CONFIRMED', now)
    await makePayment(reg1.id, 'PAID', now, { amount: 2000 })
    const reg2 = await makeRegistration(mun.id, product.id, 'PENDING', now) // no payment, still counts as a registration
    void reg2
    const cancelledReg = await makeRegistration(mun.id, product.id, 'CANCELLED', now)
    await makePayment(cancelledReg.id, 'PAID', now, { amount: 9_999 }) // a payment exception, not revenue

    const rows = await getGeographyBreakdown({ days: 7 }, sess(admin), now)
    const row = rows.find((r) => r.city === city)
    expect(row).toBeDefined()
    expect(row?.registrationCount).toBe(3)
    expect(row?.revenue).toBe(2000)
  })
})

describe('getPlatformFeeSummary', () => {
  it('reads platformFeeAmount/platformFeeTaxAmount from PAID, non-mock payments only', async () => {
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const mun = await makeMun(organizer.id)
    const product = await makeProduct(mun.id)
    const now = farFutureNow()
    const currency = `ZZFEE-${crypto.randomUUID().slice(0, 8)}`

    const reg1 = await makeRegistration(mun.id, product.id, 'CONFIRMED', now)
    await makePayment(reg1.id, 'PAID', now, { currency, platformFeeAmount: 100, platformFeeTaxAmount: 18 })
    const reg2 = await makeRegistration(mun.id, product.id, 'CONFIRMED', now)
    await makePayment(reg2.id, 'PAID', now, { currency, platformFeeAmount: 200, platformFeeTaxAmount: 36 })
    const reg3 = await makeRegistration(mun.id, product.id, 'CONFIRMED', now)
    await makePayment(reg3.id, 'FAILED', now, { currency, platformFeeAmount: 999, platformFeeTaxAmount: 180 }) // not PAID

    const summary = await getPlatformFeeSummary({ days: 7 }, sess(admin), now)
    const row = summary.find((r) => r.currency === currency)
    expect(row).toEqual({ currency, platformFeeTotal: 300, platformFeeTaxTotal: 54, paidPayments: 2 })
  })
})

afterAll(async () => {
  // FK-safe order: payments -> registrations -> registrationProducts -> muns -> users.
  // registrations/registrationProducts have no onDelete cascade to muns, so
  // deleting muns first would fail with a foreign key violation.
  if (createdMunIds.length > 0) {
    const regIdsSubquery = db
      .select({ id: registrations.id })
      .from(registrations)
      .where(inArray(registrations.munId, createdMunIds))
    await db.delete(payments).where(inArray(payments.registrationId, regIdsSubquery))
    await db.delete(registrations).where(inArray(registrations.munId, createdMunIds))
    await db.delete(registrationProducts).where(inArray(registrationProducts.munId, createdMunIds))
    await db.delete(muns).where(inArray(muns.id, createdMunIds))
  }
  if (createdUserIds.length > 0) await db.delete(users).where(inArray(users.id, createdUserIds))
  await db.$client.end()
})
