import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { browserContextFor, signUpOrganizerViaApi } from '../../fixtures/api'
import { SANDBOX } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import { anonApi, main, openSection, organizerApi, sandboxId } from './_helpers'

/**
 * "Preview as a delegate" (aa85127): the organizer sees their unpublished MUN
 * exactly as the public page will show it, with registration turned off.
 * Uses the sandbox (ONBOARDING, never public). Read-only.
 */

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  await api?.dispose()
})

function previewPath() {
  return `/organizer/muns/${munId}/preview`
}

function previewLink(page: Page) {
  const name = 'Preview as a delegate'
  return main(page).getByRole('link', { name }).or(main(page).getByRole('button', { name }))
}

test('MUN Setup links to the preview in a new tab', async ({ page }) => {
  await openSection(page, munId, 'setup', 'MUN Setup')
  const link = previewLink(page)
  await expect(link).toHaveAttribute('href', previewPath())
  await expect(link).toHaveAttribute('target', '_blank')

  const [preview] = await Promise.all([page.context().waitForEvent('page'), link.click()])
  await preview.waitForLoadState()
  await expect(preview).toHaveURL(new RegExp(`${previewPath()}$`))
  await expect(preview.getByTestId('preview-banner')).toBeVisible()
  await preview.close()
})

test('the preview shows the public page with registration off, and is not indexed', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await page.goto(previewPath())
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SANDBOX.name)
  const banner = page.getByTestId('preview-banner')
  await expect(banner).toContainText(`Preview of ${SANDBOX.name}.`)
  await expect(banner).toContainText("It isn't public yet, and registration is turned off.")
  await expect(page.locator('section#registration')).toContainText("Registration isn't open for this conference right now.")
  await expect(page.getByRole('main').getByRole('button', { name: /register now/i })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)

  await banner.getByRole('link', { name: 'Back to MUN Setup' }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/dashboard/${munId}/setup$`))
  crashes.assertNone()
})

test('the preview API is for the owner only, and the draft stays hidden from the public', async () => {
  const res = await api.get(`organizer/muns/${munId}/preview`)
  expect(res.status(), await res.text()).toBe(200)
  expect(res.headers()['cache-control']).toContain('no-store')
  const detail = await res.json()
  expect(detail).toMatchObject({ id: munId, name: SANDBOX.name })
  expect(detail).not.toHaveProperty('organizerId')

  const stranger = await signUpOrganizerViaApi()
  expect((await stranger.api.get(`organizer/muns/${munId}/preview`)).status()).toBe(403)
  await stranger.api.dispose()

  const anon = await anonApi()
  expect((await anon.get(`organizer/muns/${munId}/preview`)).status()).toBe(401)
  expect((await anon.get(`muns/${SANDBOX.slug}`)).status()).toBe(404)
  await anon.dispose()
})

test("another organizer can't open someone else's preview", async ({ browser }) => {
  const stranger = await signUpOrganizerViaApi()
  const context = await browserContextFor(browser, stranger)
  const page = await context.newPage()
  await page.goto(previewPath())
  await expect(page.getByText('Forbidden')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: SANDBOX.name })).toHaveCount(0)
  await context.close()
  await stranger.api.dispose()
})
