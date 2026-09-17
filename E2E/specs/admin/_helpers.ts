import { expect, request, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { API_ORIGIN, WEB_URL } from '../../env'
import { newApiContext, signInViaApi, signUpOrganizerViaApi, type ApiSession } from '../../fixtures/api'
import { createStaffUser, type StaffRole } from '../../fixtures/fixture-db'
import { uniqueEmail } from '../../fixtures/data'
import { STORAGE_STATE } from '../../paths'

/** API context authenticated as the seeded admin, reusing the project's saved session cookie. */
export async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.admin,
  })
}

/** A unique, searchable name for data this suite creates. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${randomUUID().slice(0, 6)}`
}

/** Creates a brand-new ORGANIZER account (never a seeded one) and returns its signed-in API session. */
export async function createOrganizer(name = uniqueName('E2E Admin Org')): Promise<ApiSession & { name: string }> {
  const session = await signUpOrganizerViaApi(name, uniqueEmail('admin-org'))
  return { ...session, name }
}

export interface FreshApplication {
  organizer: ApiSession & { name: string }
  munId: string
  munName: string
}

/** A fresh organizer submits a fresh Gate 1 application; the MUN lands in SUBMITTED. */
export async function createApplication(prefix = 'E2E Admin App'): Promise<FreshApplication> {
  const organizer = await createOrganizer()
  const munName = uniqueName(prefix)
  const response = await organizer.api.post('organizer/applications', {
    data: {
      conferenceName: munName,
      expectedDate: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      location: 'Hyderabad',
      expectedDelegateCount: 150,
      description: 'An E2E-created conference used only by the admin test suite.',
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const application = (await response.json()) as { munId: string }
  return { organizer, munId: application.munId, munName }
}

/** Status of one of the organizer's own MUNs, as the organizer's workspace sees it. */
export async function organizerMunStatus(organizer: ApiSession, munId: string): Promise<string | undefined> {
  const response = await organizer.api.get('organizer/workspace/overview')
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { muns: Array<{ id: string; status: string }> }
  return body.muns.find((mun) => mun.id === munId)?.status
}

export function main(page: Page): Locator {
  return page.getByRole('main')
}

/** A table row containing `text`. */
export function tableRow(page: Page, text: string): Locator {
  return main(page).getByRole('row').filter({ hasText: text })
}

/** Resolves once the page has painted twice, i.e. React has committed any state already queued. */
async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

/**
 * Admin tables paginate 20 at a time and the local DB carries lots of junk
 * rows, so walk "Next" until the row appears (or pages run out).
 *
 * The tables keep showing the previous page's rows while the next page loads
 * (TanStack `placeholderData`), but the "Page N of M" text changes at once.
 * So each step waits for the next page's list response and a repaint before
 * reading the rows; otherwise a stale page is searched and the row is
 * reported on the wrong page.
 */
export async function findRowAcrossPages(page: Page, text: string, maxPages = 60): Promise<Locator> {
  const row = tableRow(page, text)
  await expect(main(page).getByRole('table').or(main(page).getByText(/nothing|no .* pending|no registrations/i)).first()).toBeVisible()
  for (let i = 0; i < maxPages; i += 1) {
    if ((await row.count()) > 0) return row
    const next = main(page).getByRole('button', { name: /^next$/i })
    if ((await next.count()) === 0 || (await next.isDisabled())) break
    const indicator = main(page).getByText(/^Page \d+ of \d+$/)
    const before = await indicator.textContent()
    const pageLoaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.startsWith('/api/v1/admin/') &&
        new URL(response.url()).searchParams.has('offset'),
    )
    await next.click()
    await expect(indicator).not.toHaveText(before ?? '')
    await (await pageLoaded).finished()
    await afterNextPaint(page)
  }
  await expect(row, `row "${text}" not found on any page`).toHaveCount(1)
  return row
}

/** API context authenticated as the seeded organizer (who owns every fixture MUN). */
export async function fixtureOwnerApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.organizer,
  })
}

/** A MUN's status as staff see it. */
export async function staffMunStatus(api: APIRequestContext, munId: string): Promise<string> {
  const response = await api.get(`admin/muns/${munId}/review`)
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { status: string }).status
}

/** Status code of the public MUN page's API read (200 when live, 404 otherwise). */
export async function publicMunStatusCode(slug: string): Promise<number> {
  const anon = await newApiContext()
  const response = await anon.get(`muns/${slug}`)
  await anon.dispose()
  return response.status()
}

/**
 * Takes a ready-to-submit fixture MUN (recreateReadyMun) from ONBOARDING to
 * VERIFICATION the way its organizer would: submit, preview, attest.
 */
export async function submitForReview(owner: APIRequestContext, admin: APIRequestContext, munId: string): Promise<void> {
  const submitted = await owner.post(`muns/${munId}/actions/submit-for-review`)
  expect(submitted.status(), await submitted.text()).toBe(200)
  expect(await submitted.json()).toMatchObject({ passed: true })
  expect((await owner.get(`muns/${munId}/confirmation-preview`)).status()).toBe(200)
  const confirmed = await owner.post(`muns/${munId}/actions/submit-final-confirmation`, { data: { attested: true } })
  expect(confirmed.status(), await confirmed.text()).toBe(200)
  expect(await staffMunStatus(admin, munId)).toBe('VERIFICATION')
}

/** Accepts the next `window.confirm`, checking its text. */
export function acceptConfirm(page: Page, message: string | RegExp): void {
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('confirm')
    if (typeof message === 'string') expect(dialog.message()).toContain(message)
    else expect(dialog.message()).toMatch(message)
    void dialog.accept()
  })
}

/** A sonner toast. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.getByRole('region', { name: /notifications/i }).getByText(text)
}

export interface StaffSession extends ApiSession {
  name: string
}

/**
 * A fresh OPERATIONS / ADMIN / SUPER_ADMIN account (local DB insert) signed in
 * through the real login endpoint. Remember its email and pass it to
 * retireStaffUsers() in afterAll.
 */
export async function createStaffSession(role: StaffRole): Promise<StaffSession> {
  const name = uniqueName(`E2E ${role}`)
  const user = await createStaffUser(role, { email: uniqueEmail(`staff-${role.toLowerCase()}`), name })
  const session = await signInViaApi(user.email, user.password)
  expect(session.role).toBe(role)
  return { ...session, name }
}

export function heading(page: Page, name: string | RegExp): Locator {
  return page.getByRole('heading', { level: 1, name })
}
