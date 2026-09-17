import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { TEST_LOGIN_CODE, seedOrganizerLoginCode, signUpOrganizerViaApi } from '../../fixtures/api'
import { STORAGE_STATE } from '../../paths'
import { SANDBOX } from '../../fixtures/fixture-muns'
import { uniqueEmail } from '../../fixtures/data'

/**
 * Shared helpers for the organizer workspace specs.
 *
 * KNOWN APP BUG (the reason most UI tests here carry `test.fail`):
 * web/src/layouts/mun-workspace-layout.tsx resolves the current MUN from
 * MOCK_WORKSPACE_MUNS (web/src/mocks/organizer.ts) instead of the organizer's
 * real conferences, so every real MUN id redirects to /organizer/dashboard/muns
 * and no per-MUN section is reachable. The sidebar switcher is fed the same
 * mock list (web/src/layouts/workspace-layout.tsx).
 *
 * E2E_ORG_WORKSPACE_SHIM=1 swaps the mock list for the organizer's real MUNs
 * at the network layer (no app code touched), which is how the per-section
 * flows below were verified end to end. With the shim on, the bug markers are
 * switched off so those flows must genuinely pass.
 */
export const WORKSPACE_SHIM = process.env.E2E_ORG_WORKSPACE_SHIM === '1'

export const WORKSPACE_BUG =
  'BUG: per-MUN workspace resolves MUNs from mock data (web/src/layouts/mun-workspace-layout.tsx), so every real MUN id redirects to My MUNs'

/** Marks a test that needs a per-MUN workspace section as blocked by WORKSPACE_BUG. */
export function expectWorkspaceBug(): void {
  test.fail(!WORKSPACE_SHIM && !process.env.E2E_SHOW_KNOWN_BUGS, WORKSPACE_BUG)
}

export const PRODUCTS_LIST_BUG =
  'BUG: GET /muns/:munId/products is shadowed by the public GET /muns/:slug/products route (server/routes/muns.ts is mounted first), so the organizer products list always shows "Mun not found"'

export interface OwnedMun {
  id: string
  name: string
  slug: string
  edition: string | null
  status: string
  registrationCount: number
  confirmedCount: number
  capacity: number
}

/**
 * The API rate-limits by client IP (300 req/min global, keyed on
 * X-Forwarded-For). This suite's direct API calls would otherwise share one
 * bucket with the browser under test and starve it, so each helper context
 * presents itself as a separate client (TEST-NET-2 addresses).
 */
function helperClientIp(): string {
  return `198.51.100.${1 + Math.floor(Math.random() * 254)}`
}

/** An API context signed in as the seeded organizer, reusing the saved session (no extra login). */
export async function organizerApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL, 'x-forwarded-for': helperClientIp() },
    storageState: STORAGE_STATE.organizer,
  })
}

export async function ownedMuns(api: APIRequestContext): Promise<OwnedMun[]> {
  const res = await api.get('organizer/workspace/overview')
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { muns: OwnedMun[] }).muns
}

export async function ownedMunBySlug(api: APIRequestContext, slug: string): Promise<OwnedMun> {
  const mun = (await ownedMuns(api)).find((m) => m.slug === slug)
  if (!mun) throw new Error(`organizer does not own a MUN with slug ${slug}`)
  return mun
}

/** The sandbox is ONBOARDING, so it isn't publicly readable — resolve its id through the owner's workspace. */
export async function sandboxId(api: APIRequestContext): Promise<string> {
  return (await ownedMunBySlug(api, SANDBOX.slug)).id
}

export async function installWorkspaceShim(page: Page, muns: OwnedMun[]): Promise<void> {
  if (!WORKSPACE_SHIM) return
  const injected = JSON.stringify(
    muns.map(({ id, name, slug, edition, status }) => ({ id, name, slug, edition, status })),
  )
  await page.route(/\/src\/mocks\/organizer\.ts(\?.*)?$/, async (route) => {
    const response = await route.fetch()
    const body = `${await response.text()}\nMOCK_WORKSPACE_MUNS.splice(0, MOCK_WORKSPACE_MUNS.length, ...${injected});\n`
    await route.fulfill({ response, body })
  })
}

/** Prepares a page for workspace navigation (installs the shim when enabled). */
export async function prepareWorkspace(page: Page, api: APIRequestContext): Promise<void> {
  if (WORKSPACE_SHIM) await installWorkspaceShim(page, await ownedMuns(api))
}

export function sectionPath(munId: string, segment: string): string {
  return `/organizer/dashboard/${munId}/${segment}`
}

/** Opens a per-MUN workspace section and asserts it actually rendered there (not redirected away). */
export async function openSection(page: Page, munId: string, segment: string, heading: string | RegExp): Promise<void> {
  await page.goto(sectionPath(munId, segment))
  await expect(page).toHaveURL(new RegExp(`${sectionPath(munId, segment)}$`), { timeout: 5_000 })
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}

export function main(page: Page) {
  return page.getByRole('main')
}

/** The card for one list item (identified by its h2) inside a labelled list region. */
export function cardFor(page: Page, regionName: string, itemName: string) {
  return main(page)
    .getByRole('region', { name: regionName, exact: true })
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: itemName, exact: true }) })
    .first()
}

/** Accepts the next window.confirm() the page raises. */
export function acceptNextConfirm(page: Page): void {
  page.once('dialog', (dialog) => void dialog.accept())
}

/**
 * A signed-OUT API context. Explicitly empty storageState: inside this
 * project a bare `request.newContext()` would inherit the organizer's session.
 */
export async function anonApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL, 'x-forwarded-for': helperClientIp() },
    storageState: { cookies: [], origins: [] },
  })
}

/*
 * ORGANIZER ACCOUNT CREATION — the only two places specs create organizer
 * accounts (API and UI). Keep it that way so a change to the signup flow
 * (e.g. passwordless sign-in) is a two-function edit.
 */

/**
 * Signs a brand-new organizer up through the /organizer/signup page
 * (details -> emailed code -> verify). Leaves the page signed in, wherever
 * signup lands it. Returns the email used.
 */
export async function signUpOrganizerThroughUi(page: Page, name = 'E2E Journey Organizer'): Promise<string> {
  const email = uniqueEmail('journey-org')
  await page.goto('/organizer/signup')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/create your organizer account/i)
  const form = main(page)
  await form.getByLabel('Full name').fill(name)
  await form.getByLabel('Email address').fill(email)
  await form.getByLabel('Phone (optional)').fill('9876512345')
  await form.getByRole('checkbox', { name: /terms of service/i }).click()
  await form.getByRole('checkbox', { name: /privacy policy/i }).click()
  await form.getByRole('button', { name: /^send otp$/i }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter OTP')
  await expect(main(page)).toContainText(email.toLowerCase())
  // After "Send OTP": requesting a code consumes any older one.
  await seedOrganizerLoginCode(email)
  await expect(form.getByRole('button', { name: 'Verify and create account' })).toBeDisabled()
  // Entering the sixth digit submits the form by itself.
  await form.getByLabel('6-digit code').fill(TEST_LOGIN_CODE)
  return email
}

/** Creates a brand-new ORGANIZER through the real passwordless signup and returns a signed-in API context. */
export async function createFreshOrganizer(name = 'E2E Organizer') {
  const session = await signUpOrganizerViaApi(name)
  expect(session.role).toBe('ORGANIZER')
  return { api: session.api, email: session.email, userId: session.userId }
}

export interface ApplicationResult {
  id: string
  munId: string
  status: string
}

export async function submitApplicationViaApi(api: APIRequestContext, conferenceName: string): Promise<ApplicationResult> {
  const res = await api.post('organizer/applications', {
    data: {
      conferenceName,
      location: 'Hyderabad',
      expectedDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      expectedDelegateCount: 150,
      description: 'An end-to-end test conference with two committees and a crisis cabinet.',
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as ApplicationResult
}

/** A short unique suffix so created entities never collide across runs. */
export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A sonner toast with the given text. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole('region', { name: /notifications/i }).getByText(text)
}
