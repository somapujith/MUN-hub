import { expect, request, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { API_ORIGIN, WEB_URL } from '../../env'
import { signUpOrganizerViaApi, type ApiSession } from '../../fixtures/api'
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

/**
 * Admin tables paginate 20 at a time and the local DB carries lots of junk
 * rows, so walk "Next" until the row appears (or pages run out).
 */
export async function findRowAcrossPages(page: Page, text: string, maxPages = 30): Promise<Locator> {
  const row = tableRow(page, text)
  await expect(main(page).getByRole('table').or(main(page).getByText(/nothing|no .* pending|no registrations/i)).first()).toBeVisible()
  for (let i = 0; i < maxPages; i += 1) {
    if ((await row.count()) > 0) return row
    const next = main(page).getByRole('button', { name: /^next$/i })
    if ((await next.count()) === 0 || (await next.isDisabled())) break
    const indicator = main(page).getByText(/^Page \d+ of \d+$/)
    const before = await indicator.textContent()
    await next.click()
    await expect(indicator).not.toHaveText(before ?? '')
  }
  await expect(row, `row "${text}" not found on any page`).toHaveCount(1)
  return row
}

export function heading(page: Page, name: string | RegExp): Locator {
  return page.getByRole('heading', { level: 1, name })
}
