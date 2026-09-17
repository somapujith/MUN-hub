import { readFile } from 'node:fs/promises'
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'
import { getMun, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { API_ORIGIN, WEB_URL } from '../../env'
import { parseCsv } from '../../fixtures/csv'
import { watchForCrashes } from '../../fixtures/ui'
import { STORAGE_STATE } from '../../paths'
import {
  main,
  anonApi,
  createFreshOrganizer,
  openSection,
  organizerApi,
  ownedMunBySlug,
  uid,
} from './_helpers'

/**
 * What an organizer sees once a delegate registers and pays (Organizer
 * Dashboard PRD §17-18). Read-only against the open fixture MUN: the only
 * writes are the fresh delegate's own registration and payment.
 */

const PASS = OPEN.products[0] // E2E Delegate Pass, ₹1,499
const GA = OPEN.committees[0] // E2E General Assembly
const PORTFOLIO = GA.portfolios[0] // India

interface DelegateRow {
  id: string
  status: string
  user: Record<string, unknown> & { name: string; email: string; institution: string | null }
  committee: { name: string } | null
  registrationProduct: { name: string; price: number }
  payment: Array<{ status: string; amount: number }>
}

/** Unique per run, so search and export can single this delegate out. */
const DELEGATE_NAME = `E2E Roster Delegate ${uid()}`

let api: APIRequestContext
let openId: string
let delegate: ApiSession
let registrationId: string
let committeeId: string

test.beforeAll(async () => {
  api = await organizerApi()
  openId = (await ownedMunBySlug(api, OPEN.slug)).id

  delegate = await signUpViaApi({ name: DELEGATE_NAME })
  expect(delegate.role).toBe('STUDENT')
  const mun = await getMun(delegate.api, OPEN.slug)
  const pass = mun.registrationProducts.find((p) => p.name === PASS.name)!
  const ga = mun.committees.find((c) => c.name === GA.name)!
  committeeId = ga.id
  const portfolioId = ga.portfolios.find((p) => p.name === PORTFOLIO)!.id

  const reg = await delegate.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: { munId: mun.id, registrationProductId: pass.id, committeeId, portfolioId },
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
    expect(row!.user).toMatchObject({ name: DELEGATE_NAME, email: delegate.email, institution: 'E2E Test University' })
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

  test('roster search runs on the server across name, email, institution and registration id', async () => {
    const ids = async (query: string) => (await delegateRows(`${query}&limit=100`)).results.map((r) => r.id)
    const q = (search: string) => `search=${encodeURIComponent(search)}`
    expect(await ids(q(delegate.email.toUpperCase()))).toEqual([registrationId])
    expect(await ids(q(DELEGATE_NAME.toLowerCase()))).toEqual([registrationId])
    expect(await ids(q(registrationId.slice(0, 13)))).toEqual([registrationId])
    expect(await ids(q('E2E Test University'))).toContain(registrationId)
    // LIKE wildcards are literal, and a registration id only matches from its start.
    expect(await ids(q(`${DELEGATE_NAME.slice(0, 10)}%`))).not.toContain(registrationId)
    expect(await ids(q('_'.repeat(5)))).not.toContain(registrationId)
    expect(await ids(q(registrationId.slice(5, 18)))).not.toContain(registrationId)
    const page = await delegateRows(q(delegate.email))
    expect(page.total).toBe(1)
    expect((await api.get(`organizer/muns/${openId}/delegates?${q('x'.repeat(101))}`)).status()).toBe(400)
  })

  test('roster filters by registration status and pass', async () => {
    const mun = await getMun(api, OPEN.slug)
    const passId = (name: string) => mun.registrationProducts.find((p) => p.name === name)!.id
    const search = `search=${encodeURIComponent(delegate.email)}`
    expect(await findDelegate(`${search}&status=CONFIRMED`)).toBeDefined()
    expect(await findDelegate(`${search}&status=ATTENDED,CONFIRMED`)).toBeDefined()
    expect(await findDelegate(`${search}&status=CANCELLED,PENDING`)).toBeUndefined()
    expect(await findDelegate(`${search}&registrationProductId=${passId(PASS.name)}`)).toBeDefined()
    expect(await findDelegate(`${search}&registrationProductId=${passId(OPEN.products[1].name)}`)).toBeUndefined()
    expect((await api.get(`organizer/muns/${openId}/delegates?status=BOGUS`)).status()).toBe(400)
    expect((await api.get(`organizer/muns/${openId}/delegates?unknown=1`)).status()).toBe(400)
  })

  test('the roster list carries the MUN status but no form answers or idempotency keys', async () => {
    const res = await api.get(`organizer/muns/${openId}/delegates?search=${encodeURIComponent(delegate.email)}`)
    const body = await res.json()
    expect(body).toMatchObject({ total: 1, munStatus: 'REGISTRATION_OPEN', attendanceOpen: false })
    const [row] = body.results
    expect(row.portfolio?.name).toBe(PORTFOLIO)
    expect(row).not.toHaveProperty('formResponses')
    expect(row).not.toHaveProperty('idempotencyKey')
  })

  test('the delegate detail shows the full record to the owning organizer only', async () => {
    const path = `organizer/muns/${openId}/delegates/${registrationId}`
    const res = await api.get(path)
    expect(res.status(), await res.text()).toBe(200)
    expect(res.headers()['cache-control']).toContain('no-store')
    const raw = await res.text()
    expect(raw).not.toMatch(/password|scrypt|idempotency|token/i)
    const detail = JSON.parse(raw)
    expect(detail).toMatchObject({
      registration: { id: registrationId, status: 'CONFIRMED' },
      delegate: {
        name: DELEGATE_NAME,
        email: delegate.email,
        phone: '9876501234',
        institution: 'E2E Test University',
        profile: {
          gradeOrYear: '3rd year',
          emergencyContactName: 'E2E Guardian',
          emergencyContactRelation: 'Parent',
          emergencyContactPhone: '9876505678',
        },
      },
      pass: { name: PASS.name, price: PASS.price },
      committee: { name: GA.name },
      portfolio: { name: PORTFOLIO },
      payment: { status: 'PAID', amount: PASS.price },
      checkIn: { state: 'NOT_CHECKED_IN', recordedAt: null },
    })
    expect(detail.delegate.profile.dateOfBirth).toMatch(/^2004-06-15/)

    // Unknown ids read as not found; nobody else may read the record.
    expect((await api.get(`organizer/muns/${openId}/delegates/${crypto.randomUUID()}`)).status()).toBe(404)
    const stranger = await createFreshOrganizer()
    expect((await stranger.api.get(path)).status()).toBe(403)
    await stranger.api.dispose()
    expect((await delegate.api.get(path)).status()).toBe(403)
    const admin = await adminApi()
    expect((await admin.get(path)).status()).toBe(403)
    await admin.dispose()
    const anon = await anonApi()
    expect((await anon.get(path)).status()).toBe(401)
    await anon.dispose()
  })

  test('the CSV export is an owner-only attachment with the filtered roster and no secrets', async () => {
    const path = `organizer/muns/${openId}/delegates/export?search=${encodeURIComponent(delegate.email)}`
    const res = await api.get(path)
    expect(res.status(), await res.text()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="e2e-open-mun-delegates-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(res.headers()['cache-control']).toContain('no-store')
    const text = (await res.body()).toString('utf8')
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const csv = parseCsv(text)
    expectRosterCsv(csv)
    expect(csv.rows).toHaveLength(1)

    const stranger = await createFreshOrganizer()
    expect((await stranger.api.get(path)).status()).toBe(403)
    await stranger.api.dispose()
    expect((await delegate.api.get(path)).status()).toBe(403)
    const admin = await adminApi()
    expect((await admin.get(path)).status()).toBe(403)
    await admin.dispose()
    const anon = await anonApi()
    expect((await anon.get(path)).status()).toBe(401)
    await anon.dispose()
  })
})

async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.admin,
  })
}

const EXPORT_HEADERS = [
  'Registration ID',
  'Registration status',
  'Checked in',
  'Name',
  'Email',
  'Phone',
  'Institution',
  'Pass',
  'Committee',
  'Portfolio',
  'Payment status',
  'Amount',
  'Currency',
  'Registered at',
]

/** The export's fixed columns come first, no column is a secret, and the fresh delegate's row is complete. */
function expectRosterCsv(csv: { header: string[]; rows: string[][] }) {
  expect(csv.header.slice(0, EXPORT_HEADERS.length)).toEqual(EXPORT_HEADERS)
  for (const column of csv.header) expect(column, 'sensitive column').not.toMatch(/password|hash|token|secret|idempotency|session/i)
  const row = csv.rows.find((r) => r[0] === registrationId)
  expect(row, 'delegate row in export').toBeDefined()
  const cell = (name: string) => row![csv.header.indexOf(name)]
  expect(row!.length).toBe(csv.header.length)
  expect(cell('Registration status')).toBe('CONFIRMED')
  expect(cell('Checked in')).toBe('No')
  expect(cell('Name')).toBe(DELEGATE_NAME)
  expect(cell('Email')).toBe(delegate.email)
  expect(cell('Phone')).toBe('9876501234')
  expect(cell('Institution')).toBe('E2E Test University')
  expect(cell('Pass')).toBe(PASS.name)
  expect(cell('Committee')).toBe(GA.name)
  expect(cell('Portfolio')).toBe(PORTFOLIO)
  expect(cell('Payment status')).toBe('PAID')
  expect(cell('Amount')).toBe(String(PASS.price))
  expect(cell('Registered at')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  for (const value of row!) expect(value).not.toMatch(/scrypt|\$2[aby]\$|e2e-strong-password/)
}

test.describe('registration roster UI', () => {
  test('the Registrations section lists the paid delegate', async ({ page }) => {
    await openSection(page, openId, 'registrations', 'Registrations')
    await expect(main(page).getByText(/\d+–\d+ of \d+/)).toBeVisible()
    const row = await rosterRow(page)
    await expect(row).toContainText(DELEGATE_NAME)
    await expect(row).toContainText('E2E Test University')
    await expect(row).toContainText(GA.name)
    await expect(row).toContainText('Confirmed')
    await expect(row).toContainText('Paid')
    await expect(row).toContainText('₹1,499')
  })

  test('filtering by committee and payment status narrows the roster', async ({ page }) => {
    await openSection(page, openId, 'registrations', 'Registrations')
    await main(page).getByLabel('Committee').selectOption({ label: GA.name })
    await main(page).getByLabel('Payment status').selectOption({ label: 'Paid' })
    await expect(await rosterRow(page)).toHaveCount(1)
    await main(page).getByLabel('Search delegates').fill(delegate.email)
    await expect(main(page).getByRole('row').filter({ hasText: delegate.email })).toHaveCount(1)

    await main(page).getByLabel('Payment status').selectOption({ label: 'Payment failed' })
    await expect(main(page).getByRole('row').filter({ hasText: delegate.email })).toHaveCount(0)
  })

  test('the roster shows portfolio and pass, with view and export actions and no refund', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openSection(page, openId, 'registrations', 'Registrations')
    await main(page).getByLabel('Search delegates').fill(delegate.email)
    const row = main(page).getByRole('row').filter({ hasText: delegate.email })
    await expect(row).toHaveCount(1)
    await expect(main(page).getByRole('row')).toHaveCount(2)
    await expect(main(page).getByText('1–1 of 1')).toBeVisible()
    for (const column of ['Delegate', 'Pass', 'Committee / portfolio', 'Status', 'Payment', 'Registered']) {
      await expect(main(page).getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }
    await expect(row).toContainText(PASS.name)
    await expect(row).toContainText(`${GA.name}${PORTFOLIO}`)
    await expect(row.getByRole('button', { name: 'View' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Export CSV' })).toBeEnabled()
    // MUN Hub has no refunds; attendance is only offered during the conference.
    await expect(main(page).getByRole('button', { name: /refund/i })).toHaveCount(0)
    await expect(main(page).getByLabel('Payment status').getByRole('option', { name: /refund/i })).toHaveCount(0)
    await expect(row.getByRole('button', { name: /attended|no-show/i })).toHaveCount(0)
    await expect(main(page)).not.toContainText('The conference is under way')
    crashes.assertNone()
  })

  test.fixme('the roster can reassign a delegate\'s committee/portfolio and cancel a registration', async () => {
    // Organizer Dashboard PRD §17: the roster has view, export and attendance
    // actions, but no assign or cancel action yet (refunds don't exist by design).
  })

  test('opening a delegate shows their full record in a drawer', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openSection(page, openId, 'registrations', 'Registrations')
    await main(page).getByLabel('Search delegates').fill(delegate.email)
    const row = main(page).getByRole('row').filter({ hasText: delegate.email })
    await row.getByRole('button', { name: DELEGATE_NAME }).click()

    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('heading', { name: DELEGATE_NAME })).toBeVisible()
    await expect(drawer).toContainText(registrationId)
    await expect(drawer).toContainText('Confirmed')
    for (const [section, text] of [
      ['Contact', delegate.email],
      ['Contact', '9876501234'],
      ['Registration', `${PASS.name} · ₹1,499`],
      ['Registration', PORTFOLIO],
      ['Payment', 'Paid'],
      ['Check-in', 'Not checked in yet'],
      ['Participant profile', 'E2E Guardian (Parent) · 9876505678'],
      ['Participant profile', '3rd year'],
    ] as const) {
      await expect(drawer.getByRole('heading', { name: section, exact: true })).toBeVisible()
      await expect(drawer, section).toContainText(text)
    }
    await expect(drawer.getByRole('heading', { name: 'Registration answers' })).toBeVisible()
    // Attendance can't be recorded before the conference.
    await expect(drawer.getByRole('button', { name: /mark (attended|no-show)/i })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)

    // "View" opens the same record.
    await row.getByRole('button', { name: 'View' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: DELEGATE_NAME })).toBeVisible()
    crashes.assertNone()
  })

  test('the roster search box filters on the server and shows an empty state', async ({ page }) => {
    await openSection(page, openId, 'registrations', 'Registrations')
    const search = main(page).getByLabel('Search delegates')
    await search.fill(DELEGATE_NAME.toUpperCase())
    await expect(main(page).getByRole('row').filter({ hasText: delegate.email })).toHaveCount(1)
    await expect(main(page).getByText('1–1 of 1')).toBeVisible()
    await search.fill(`no such delegate ${uid()}`)
    await expect(main(page).getByRole('heading', { name: 'No delegates match these filters' })).toBeVisible()
    await expect(main(page).getByText('No delegates match', { exact: true })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    await search.fill('')
    await expect(main(page).getByText(/^\d+–\d+ of \d+$/)).toBeVisible()
  })

  test('Export CSV downloads the filtered roster', async ({ page }) => {
    await openSection(page, openId, 'registrations', 'Registrations')
    await main(page).getByLabel('Search delegates').fill(delegate.email)
    await expect(main(page).getByText('1–1 of 1')).toBeVisible()
    const downloadEvent = page.waitForEvent('download')
    await main(page).getByRole('button', { name: 'Export CSV' }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toMatch(/^e2e-open-mun-delegates-\d{4}-\d{2}-\d{2}\.csv$/)
    const text = await readFile(await download.path(), 'utf8')
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const csv = parseCsv(text)
    expectRosterCsv(csv)
    expect(csv.rows).toHaveLength(1)
  })

  test('Export CSV without filters includes every delegate, this one among them', async ({ page }) => {
    await openSection(page, openId, 'registrations', 'Registrations')
    await expect(main(page).getByText(/^\d+–\d+ of \d+$/)).toBeVisible()
    const total = Number((await main(page).getByText(/^\d+–\d+ of \d+$/).textContent())!.split(' of ')[1])
    const downloadEvent = page.waitForEvent('download')
    await main(page).getByRole('button', { name: 'Export CSV' }).click()
    const csv = parseCsv(await readFile(await (await downloadEvent).path(), 'utf8'))
    expectRosterCsv(csv)
    // Other specs may register delegates meanwhile, so never fewer than the page said.
    expect(csv.rows.length).toBeGreaterThanOrEqual(total)
  })

  test('Analytics shows the pass\'s confirmed registrations and revenue', async ({ page }) => {
    await openSection(page, openId, 'analytics', 'Analytics')
    await expect(main(page).getByText('Confirmed registrations', { exact: true })).toBeVisible()
    const row = main(page).getByRole('row').filter({ hasText: PASS.name })
    await expect(row).toContainText('₹1,499')
    await expect(row).toContainText(String(PASS.capacity))
    await expect(row.getByRole('cell').nth(3)).not.toHaveText('0')
    // An inactive pass is still reported to the organizer.
    await expect(main(page).getByRole('row').filter({ hasText: OPEN.products[2].name })).toHaveCount(1)
  })

  test('Communications counts the delegate as a recipient without listing addresses', async ({ page }) => {
    const mun = await getMun(api, OPEN.slug)
    const gaId = mun.committees.find((c) => c.name === GA.name)!.id
    const preview = await (await api.get(`organizer/muns/${openId}/communications/audience?committeeId=${gaId}`)).json()
    expect(preview.recipientCount).toBeGreaterThanOrEqual(1)

    await openSection(page, openId, 'communications', 'Communications')
    await main(page).getByLabel('Committee').selectOption({ label: GA.name })
    await main(page).getByLabel('Pass').selectOption({ label: PASS.name })
    await expect(main(page).getByText(/^\d+ delegates?$/)).toBeVisible()
    await expect(main(page)).toContainText(/Will be sent to \d+ delegates?\./)
    await expect(main(page)).not.toContainText(delegate.email)
    await expect(main(page).getByRole('button', { name: /copy \d+ emails?/i })).toHaveCount(0)
  })

  test('Payments & Finance shows no delegate payment data it should not', async ({ page }) => {
    await openSection(page, openId, 'finance', 'Payments & Finance')
    await expect(main(page).getByText(/^(Set up|Update) settlement settings$/)).toBeVisible()
    await expect(main(page)).not.toContainText(delegate.email)
  })
})
