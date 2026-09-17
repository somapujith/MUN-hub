import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { getMun, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import {
  expectWorkspaceBug,
  main,
  createFreshOrganizer,
  openSection,
  organizerApi,
  ownedMunBySlug,
  prepareWorkspace,
} from './_helpers'

/**
 * What an organizer sees once a delegate registers and pays (Organizer
 * Dashboard PRD §17-18). Read-only against the open fixture MUN: the only
 * writes are the fresh delegate's own registration and payment.
 */

const PASS = OPEN.products[0] // E2E Delegate Pass, ₹1,499
const GA = OPEN.committees[0] // E2E General Assembly

interface DelegateRow {
  id: string
  status: string
  user: Record<string, unknown> & { name: string; email: string; institution: string | null }
  committee: { name: string } | null
  registrationProduct: { name: string; price: number }
  payment: Array<{ status: string; amount: number }>
}

let api: APIRequestContext
let openId: string
let delegate: ApiSession
let registrationId: string
let committeeId: string

test.beforeAll(async () => {
  api = await organizerApi()
  openId = (await ownedMunBySlug(api, OPEN.slug)).id

  delegate = await signUpViaApi({ name: 'E2E Roster Delegate' })
  expect(delegate.role).toBe('STUDENT')
  const mun = await getMun(delegate.api, OPEN.slug)
  const pass = mun.registrationProducts.find((p) => p.name === PASS.name)!
  committeeId = mun.committees.find((c) => c.name === GA.name)!.id

  const reg = await delegate.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: { munId: mun.id, registrationProductId: pass.id, committeeId },
  })
  expect(reg.status(), await reg.text()).toBe(201)
  registrationId = (await reg.json()).registrationId
  expect(registrationId).toBeTruthy()

  const paid = await delegate.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
  expect(paid.ok(), await paid.text()).toBe(true)
  const detail = await (await delegate.api.get(`registrations/${registrationId}`)).json()
  expect(detail.status).toBe('CONFIRMED')
})

test.afterAll(async () => {
  await delegate?.api.dispose()
  await api?.dispose()
})

async function delegateRows(query: string): Promise<{ results: DelegateRow[]; total: number }> {
  const res = await api.get(`organizer/muns/${openId}/delegates?${query}`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

async function findDelegate(query = ''): Promise<DelegateRow | undefined> {
  for (let offset = 0; ; offset += 100) {
    const page = await delegateRows(`${query}${query ? '&' : ''}limit=100&offset=${offset}`)
    const hit = page.results.find((r) => r.id === registrationId)
    if (hit || offset + 100 >= page.total) return hit
  }
}

/** Pages through the roster UI until the delegate's row shows up. */
async function rosterRow(page: Page) {
  const row = main(page).getByRole('row').filter({ hasText: delegate.email })
  for (let i = 0; i < 20; i += 1) {
    await expect(main(page).getByText(/Loading delegates/)).toHaveCount(0)
    if (await row.count()) return row
    const next = main(page).getByRole('button', { name: /next/i })
    if (!(await next.isEnabled())) break
    await next.click()
  }
  return row
}

test.describe('registration roster API', () => {
  test('the paid delegate is listed with pass, committee, status and payment', async () => {
    const row = await findDelegate()
    expect(row, 'delegate missing from roster').toBeDefined()
    expect(row!.status).toBe('CONFIRMED')
    expect(row!.user).toMatchObject({ name: 'E2E Roster Delegate', email: delegate.email, institution: 'E2E Test University' })
    expect(row!.committee?.name).toBe(GA.name)
    expect(row!.registrationProduct.name).toBe(PASS.name)
    expect(row!.payment).toEqual([expect.objectContaining({ status: 'PAID', amount: PASS.price })])
  })

  test('roster filters by committee and payment status', async () => {
    expect(await findDelegate(`committeeId=${committeeId}`)).toBeDefined()
    expect(await findDelegate('paymentStatus=PAID')).toBeDefined()
    expect(await findDelegate('paymentStatus=FAILED')).toBeUndefined()
    const other = (await getMun(api, OPEN.slug)).committees.find((c) => c.name !== GA.name)!
    expect(await findDelegate(`committeeId=${other.id}`)).toBeUndefined()
    expect((await api.get(`organizer/muns/${openId}/delegates?limit=1000`)).status()).toBe(400)
  })

  test('the roster never exposes delegates\' credentials or session data', async () => {
    test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: GET /organizer/muns/:munId/delegates returns the full users row (lib/actions/organizer-dashboard.ts#queryDelegates `user: true`), including passwordHash, to the organizer')
    const row = await findDelegate()
    expect(row).toBeDefined()
    for (const key of Object.keys(row!.user)) {
      expect(key, `user.${key} leaked`).not.toMatch(/password|hash|token|secret/i)
    }
  })

  test('the organizer can open their own delegate\'s registration', async () => {
    const res = await api.get(`registrations/${registrationId}`)
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'CONFIRMED', productName: PASS.name, committee: { name: GA.name } })
  })

  test('another organizer cannot see this MUN\'s delegates or registrations', async () => {
    const stranger = await createFreshOrganizer()
    expect((await stranger.api.get(`organizer/muns/${openId}/delegates`)).status()).toBe(403)
    expect([403, 404]).toContain((await stranger.api.get(`registrations/${registrationId}`)).status())
    expect((await stranger.api.get(`organizer/muns/${openId}/analytics`)).status()).toBe(403)
    expect((await stranger.api.get(`organizer/muns/${openId}/overview`)).status()).toBe(403)
    await stranger.api.dispose()
  })

  test('workspace totals and analytics count the registration', async () => {
    const summary = await ownedMunBySlug(api, OPEN.slug)
    expect(summary.confirmedCount).toBeGreaterThanOrEqual(1)
    expect(summary.registrationCount).toBeGreaterThanOrEqual(summary.confirmedCount)

    const analytics = await (await api.get(`organizer/muns/${openId}/analytics`)).json()
    expect(analytics.totalRegistrations).toBeGreaterThanOrEqual(1)
    expect(analytics.totalRevenue).toBeGreaterThanOrEqual(PASS.price)
    const pass = analytics.products.find((p: { productName: string }) => p.productName === PASS.name)
    expect(pass).toMatchObject({ price: PASS.price, capacity: PASS.capacity })
    expect(pass.registrationCount).toBeGreaterThanOrEqual(1)
    expect(pass.revenue).toBeGreaterThanOrEqual(PASS.price)
  })
})

test.describe('registration roster UI', () => {
  test.beforeEach(async ({ page }) => {
    await prepareWorkspace(page, api)
  })

  test('the Registrations section lists the paid delegate', async ({ page }) => {
    expectWorkspaceBug()
    await openSection(page, openId, 'registrations', 'Registrations')
    await expect(main(page).getByText(/\d+–\d+ of \d+/)).toBeVisible()
    const row = await rosterRow(page)
    await expect(row).toContainText('E2E Roster Delegate')
    await expect(row).toContainText('E2E Test University')
    await expect(row).toContainText(GA.name)
    await expect(row).toContainText('Confirmed')
    await expect(row).toContainText('Paid')
    await expect(row).toContainText('₹1,499')
  })

  test('filtering by committee and payment status narrows the roster', async ({ page }) => {
    expectWorkspaceBug()
    await openSection(page, openId, 'registrations', 'Registrations')
    await main(page).getByLabel('Committee').selectOption({ label: GA.name })
    await main(page).getByLabel('Payment status').selectOption({ label: 'Paid' })
    await main(page).getByLabel('Search this page').fill(delegate.email)
    await expect(main(page).getByRole('row').filter({ hasText: delegate.email })).toHaveCount(1)

    await main(page).getByLabel('Payment status').selectOption({ label: 'Payment failed' })
    await expect(main(page).getByRole('row').filter({ hasText: delegate.email })).toHaveCount(0)
  })

  test.fixme('the roster shows portfolio and pass, with view/assign/cancel/refund/export actions', async () => {
    // Organizer Dashboard PRD §17: the table has no Portfolio or pass column,
    // no registration-type/institution/date filters, and no row actions.
  })

  test('Analytics shows the pass\'s confirmed registrations and revenue', async ({ page }) => {
    expectWorkspaceBug()
    await openSection(page, openId, 'analytics', 'Analytics')
    await expect(main(page).getByText('Confirmed registrations', { exact: true })).toBeVisible()
    const row = main(page).getByRole('row').filter({ hasText: PASS.name })
    await expect(row).toContainText('₹1,499')
    await expect(row).toContainText(String(PASS.capacity))
    await expect(row.getByRole('cell').nth(3)).not.toHaveText('0')
    // An inactive pass is still reported to the organizer.
    await expect(main(page).getByRole('row').filter({ hasText: OPEN.products[2].name })).toHaveCount(1)
  })

  test('Communications lists the delegate for manual outreach', async ({ page }) => {
    expectWorkspaceBug()
    await openSection(page, openId, 'communications', 'Communications')
    await main(page).getByLabel('Committee').selectOption({ label: GA.name })
    await main(page).getByLabel('Payment status').selectOption({ label: 'Paid' })
    await expect(main(page).getByRole('row').filter({ hasText: delegate.email })).toContainText('PAID')
    await expect(main(page).getByRole('button', { name: /copy \d+ emails?/i })).toBeVisible()
  })

  test('Payments & Finance shows no delegate payment data it should not', async ({ page }) => {
    expectWorkspaceBug()
    await openSection(page, openId, 'finance', 'Payments & Finance')
    await expect(main(page).getByText(/^(Set up|Update) settlement settings$/)).toBeVisible()
    await expect(main(page)).not.toContainText(delegate.email)
  })
})
