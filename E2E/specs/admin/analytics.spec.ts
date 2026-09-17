import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { newApiContext, signUpViaApi } from '../../fixtures/api'
import { retireStaffUsers } from '../../fixtures/fixture-db'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, createOrganizer, createStaffSession, heading, main } from './_helpers'

/**
 * Overview "Platform activity" (GET /admin/analytics). The local database is
 * shared with other suites that keep adding rows, so the page is compared
 * with API reads taken just before and just after it renders — never with
 * absolute counts.
 */

const REGISTRATION_ORDER = ['CONFIRMED', 'ATTENDED', 'NO_SHOW', 'PENDING', 'PAYMENT_PENDING', 'CANCELLED', 'REFUNDED'] as const

interface Revenue {
  currency: string
  gmv: number
  platformFeeTotal: number
  paidPayments: number
  paidPaymentsWithoutFeeBreakdown: number
}

interface Analytics {
  revenue: Revenue[]
  registrationsByStatus: Record<string, number>
  liveMuns: number
  newOrganizersLast7Days: number
  generatedAt: string
}

let admin: APIRequestContext

test.beforeAll(async () => {
  admin = await adminApi()
})

test.afterAll(async () => {
  await admin?.dispose()
})

async function analytics(api: APIRequestContext = admin): Promise<Analytics> {
  const response = await api.get('admin/analytics')
  expect(response.status(), await response.text()).toBe(200)
  return response.json()
}

function inr(data: Analytics): Revenue {
  return (
    data.revenue.find((row) => row.currency === 'INR') ??
    data.revenue[0] ?? { currency: 'INR', gmv: 0, platformFeeTotal: 0, paidPayments: 0, paidPaymentsWithoutFeeBreakdown: 0 }
  )
}

/** A stat tile's value (the first <dd> after its <dt>). */
function tileValue(page: Page, label: string): Locator {
  return main(page)
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })

/** "1,234" → 1234; compact "1.2K"/"3.4L" can't be read back exactly, so returns null. */
function plainNumber(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, '')
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null
}

function expectBetween(value: number, a: number, b: number, what: string) {
  expect(value, what).toBeGreaterThanOrEqual(Math.min(a, b))
  expect(value, what).toBeLessThanOrEqual(Math.max(a, b))
}

async function expectCount(locator: Locator, before: number, after: number, what: string) {
  const text = (await locator.textContent())?.trim() ?? ''
  const value = plainNumber(text)
  if (value !== null) {
    expectBetween(value, before, after, what)
  } else {
    // Large values render compact; accept the compact form of either read.
    expect([compact.format(before), compact.format(after)], what).toContain(text)
  }
}

test.describe('platform activity', () => {
  test('the overview shows the same numbers as the analytics API', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const before = await analytics()
    await page.goto('/admin')
    await expect(heading(page, 'Overview')).toBeVisible()
    await expect(main(page).getByRole('heading', { level: 2, name: 'Platform activity' })).toBeVisible()
    for (const label of ['Gross merchandise value', 'Platform fees', 'Live conferences', 'New organizers']) {
      await expect(tileValue(page, label)).toHaveText(/\S/)
    }
    const registrations = main(page).getByRole('region', { name: 'Registrations by status' })
    await expect(registrations).toBeVisible()
    await expect(registrations.getByRole('definition')).toHaveCount(REGISTRATION_ORDER.length)
    const after = await analytics()

    await expectCount(tileValue(page, 'Live conferences'), before.liveMuns, after.liveMuns, 'live conferences')
    await expectCount(
      tileValue(page, 'New organizers'),
      before.newOrganizersLast7Days,
      after.newOrganizersLast7Days,
      'new organizers',
    )

    // Money tiles are compact; their title carries the full rupee amount.
    const gmvTitle = await tileValue(page, 'Gross merchandise value').getAttribute('title')
    expect(gmvTitle).toBeTruthy()
    expectBetween(plainNumber(gmvTitle!)!, Math.round(inr(before).gmv), Math.round(inr(after).gmv), 'GMV')
    const feeTitle = await tileValue(page, 'Platform fees').getAttribute('title')
    expectBetween(
      plainNumber(feeTitle!)!,
      Math.round(inr(before).platformFeeTotal),
      Math.round(inr(after).platformFeeTotal),
      'platform fees',
    )
    const gmvNote = main(page).getByText(/^[\d,]+ paid payments?/)
    await expect(gmvNote).toBeVisible()
    const paid = plainNumber(((await gmvNote.textContent()) ?? '').split(' ')[0])!
    expectBetween(paid, inr(before).paidPayments, inr(after).paidPayments, 'paid payments')
    if (inr(before).paidPaymentsWithoutFeeBreakdown > 0 && inr(after).paidPaymentsWithoutFeeBreakdown > 0) {
      await expect(main(page).getByText(/^Excludes \d+ older payments? with no fee breakdown$/)).toBeVisible()
    }

    const values = registrations.getByRole('definition')
    let totalBefore = 0
    let totalAfter = 0
    for (const [index, status] of REGISTRATION_ORDER.entries()) {
      const a = before.registrationsByStatus[status] ?? 0
      const b = after.registrationsByStatus[status] ?? 0
      totalBefore += a
      totalAfter += b
      expectBetween(plainNumber((await values.nth(index).textContent()) ?? '')!, a, b, status)
    }
    const total = registrations.getByText(/^[\d,]+ in total$/)
    expectBetween(plainNumber(((await total.textContent()) ?? '').replace(' in total', ''))!, totalBefore, totalAfter, 'total')
    crashes.assertNone()
  })

  test('the analytics API returns well-formed totals', async () => {
    const data = await analytics()
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false)
    expect(Number.isInteger(data.liveMuns) && data.liveMuns >= 0).toBe(true)
    expect(Number.isInteger(data.newOrganizersLast7Days) && data.newOrganizersLast7Days >= 0).toBe(true)
    for (const status of REGISTRATION_ORDER) {
      expect(Number.isInteger(data.registrationsByStatus[status]), status).toBe(true)
    }
    for (const row of data.revenue) {
      expect(row.currency).toMatch(/^\S+$/)
      for (const key of ['gmv', 'platformFeeTotal', 'paidPayments', 'paidPaymentsWithoutFeeBreakdown'] as const) {
        expect(Number(row[key]), `${row.currency}.${key}`).toBeGreaterThanOrEqual(0)
      }
      expect(row.paidPaymentsWithoutFeeBreakdown).toBeLessThanOrEqual(row.paidPayments)
    }
    // Largest GMV first.
    const gmvs = data.revenue.map((row) => Number(row.gmv))
    expect(gmvs).toEqual([...gmvs].sort((a, b) => b - a))
  })

  test('a new organizer account is counted in the last 7 days', async ({ page }) => {
    const before = await analytics()
    const organizer = await createOrganizer()
    await organizer.api.dispose()
    const after = await analytics()
    expect(after.newOrganizersLast7Days).toBeGreaterThanOrEqual(before.newOrganizersLast7Days + 1)

    await page.goto('/admin')
    const tile = tileValue(page, 'New organizers')
    await expect(tile).toHaveText(/\S/)
    const shown = plainNumber((await tile.textContent()) ?? '')
    if (shown !== null) expect(shown).toBeGreaterThanOrEqual(before.newOrganizersLast7Days + 1)
  })

  test('analytics are staff-only', async () => {
    const operations = await createStaffSession('OPERATIONS')
    try {
      await analytics(operations.api)
    } finally {
      await operations.api.dispose()
      await retireStaffUsers([operations.email])
    }
    const student = await signUpViaApi()
    expect((await student.api.get('admin/analytics')).status()).toBe(403)
    await student.api.dispose()
    const organizer = await createOrganizer()
    expect((await organizer.api.get('admin/analytics')).status()).toBe(403)
    await organizer.api.dispose()
    const anon = await newApiContext()
    expect((await anon.get('admin/analytics')).status()).toBe(401)
    await anon.dispose()
  })
})
