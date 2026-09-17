import { expect, test, type Page } from '@playwright/test'
import { browserContextFor, signUpViaApi } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'

/**
 * PRD §34: "The entire workflow must work comfortably on mobile." Runs in
 * the `mobile` project (Pixel 7 viewport, touch). Signed out by default.
 */

async function expectNoHorizontalOverflow(page: Page) {
  // Overflow typically appears only once data-driven content renders, so
  // measure after the page settles, not at first paint.
  await page.waitForLoadState('networkidle')
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(clientWidth + 1)
}

const PUBLIC_PAGES = [
  '/',
  '/muns',
  `/mun/${OPEN.slug}`,
  '/login',
  '/signup',
  '/organizer/signup',
  '/forgot-password',
  '/about',
  '/about/curation',
  '/contact',
  '/legal',
  '/legal/terms',
  '/legal/privacy',
  '/legal/refunds',
]

// Pages with a confirmed sideways-scroll bug. Delete an entry once fixed —
// its test will otherwise start "unexpectedly passing".
const KNOWN_OVERFLOW: Record<string, string> = {}

for (const path of PUBLIC_PAGES) {
  test(`${path} fits the phone screen without sideways scrolling`, async ({ page }) => {
    test.fail(Boolean(KNOWN_OVERFLOW[path]) && !process.env.E2E_SHOW_KNOWN_BUGS, KNOWN_OVERFLOW[path])
    const crashes = watchForCrashes(page)
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    crashes.assertNone()
  })
}

test('the mobile menu opens, navigates, and closes', async ({ page }) => {
  await page.goto('/')
  // The desktop primary nav collapses behind a menu button on phones.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()
  await page.getByRole('button', { name: 'Open menu' }).click()

  const sheet = page.getByRole('dialog', { name: 'Menu' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: 'Marketplace' }).click()
  await expect(page).toHaveURL(/\/muns/)
  await expect(sheet).toBeHidden()
})

test('primary actions are comfortably tappable', async ({ page }) => {
  await page.goto('/login')
  for (const control of [page.locator('#email'), page.locator('#password'), page.getByRole('main').getByRole('button', { name: /^sign in$/i })]) {
    const box = await control.boundingBox()
    expect(box, 'control is rendered').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(40)
  }
})

test('the signup form is completable on a phone', async ({ page }) => {
  await page.goto('/signup')
  const submit = page.getByRole('main').getByRole('button', { name: /create account/i })
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeInViewport()
  await expectNoHorizontalOverflow(page)
})

test.describe('signed in', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a delegate can register and pay on a phone', async ({ browser }) => {
    const session = await signUpViaApi()
    // browserContextFor would drop the device profile, so re-apply the phone viewport.
    const context = await browserContextFor(browser, session)
    const page = await context.newPage()
    await page.setViewportSize({ width: 412, height: 915 })
    const crashes = watchForCrashes(page)

    await page.goto(`/mun/${OPEN.slug}`)
    await page.getByRole('main').getByRole('button', { name: /register now/i }).click()
    await page.getByRole('main').getByRole('radio', { name: new RegExp(OPEN.products[0].name) }).check()
    await page.getByRole('main').getByRole('button', { name: /continue to details/i }).click()
    await expect(page.locator('#fullName')).toHaveValue('E2E Delegate')
    await expectNoHorizontalOverflow(page)
    await page.getByRole('main').getByRole('button', { name: /^review$/i }).click()
    await page.getByRole('main').getByRole('button', { name: /confirm and pay/i }).click()
    await expect(page.getByRole('heading', { level: 1, name: /complete your payment/i })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('main').getByRole('button', { name: /^pay /i }).click()
    await expect(page.getByRole('main')).toContainText(/you're registered/i)

    await page.goto('/dashboard')
    await expect(page.getByRole('main')).toContainText(OPEN.name)
    await expectNoHorizontalOverflow(page)
    crashes.assertNone()
    await context.close()
  })
})
