import { expect, test, type Page } from '@playwright/test'
import { browserContextFor, signUpViaApi } from '../../fixtures/api'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'

/**
 * About, Curation standards, Contact and Legal pages (39a6157). Signed out
 * unless a test says otherwise.
 */

const PAGES = [
  { path: '/about', title: 'What is MUN Hub', heading: 'One trusted place to find and join Model UN conferences' },
  { path: '/about/curation', title: 'Curation standards', heading: 'How a conference earns its place on MUN Hub' },
  { path: '/contact', title: 'Contact', heading: 'How can we help?' },
  { path: '/legal', title: 'Legal', heading: 'Our policies, in plain language' },
  { path: '/legal/terms', title: 'Terms of service', heading: 'Terms of service' },
  { path: '/legal/privacy', title: 'Privacy policy', heading: 'Privacy policy' },
  { path: '/legal/refunds', title: 'Refund policy', heading: 'Refund policy' },
] as const

function footer(page: Page) {
  return page.getByRole('contentinfo')
}

for (const { path, title, heading } of PAGES) {
  test(`${path} renders with its own title, heading and description`, async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto(path)
    await expect(pageHeading(page)).toHaveText(heading)
    await expect(page).toHaveTitle(new RegExp(`^${title}( \\| MUN Hub)?$`))
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S{20,}|.{40,}/)
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(footer(page)).toBeVisible()
    crashes.assertNone()
  })
}

test('the footer links reach every content page', async ({ page }) => {
  const links: Array<[string, RegExp]> = [
    ['What is MUN Hub', /\/about$/],
    ['Curation standards', /\/about\/curation$/],
    ['Contact', /\/contact$/],
    ['Terms of service', /\/legal\/terms$/],
    ['Privacy policy', /\/legal\/privacy$/],
    ['Refund policy', /\/legal\/refunds$/],
    ['All policies', /\/legal$/],
  ]
  for (const [name, url] of links) {
    await page.goto('/')
    await footer(page).getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(url)
    await expect(pageHeading(page)).toBeVisible()
  }
})

test('footer anchors land on the matching curation section', async ({ page }) => {
  await page.goto('/')
  await footer(page).getByRole('link', { name: 'How verification works' }).click()
  await expect(page).toHaveURL(/\/about\/curation#review-process$/)
  await expect(page.locator('#review-process')).toBeInViewport()

  await page.goto('/')
  await footer(page).getByRole('link', { name: 'Organizer guidelines' }).click()
  await expect(page).toHaveURL(/\/about\/curation#organizer-responsibilities$/)
  await expect(page.locator('#organizer-responsibilities')).toBeInViewport()
})

test('the legal index links to every policy', async ({ page }) => {
  for (const [name, url] of [
    ['Terms of service', /\/legal\/terms$/],
    ['Privacy policy', /\/legal\/privacy$/],
    ['Refund policy', /\/legal\/refunds$/],
  ] as const) {
    await page.goto('/legal')
    // Each policy is a whole card link, named by its heading plus summary.
    await page
      .getByRole('main')
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .click()
    await expect(page).toHaveURL(url)
    await expect(pageHeading(page)).toHaveText(name)
  }
})

test('the policy switcher marks the current policy and moves between them', async ({ page }) => {
  await page.goto('/legal/terms')
  const switcher = page.getByRole('navigation', { name: 'Legal documents' })
  await expect(switcher.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('aria-current', 'page')
  await expect(switcher.getByRole('link', { name: 'Privacy policy' })).not.toHaveAttribute('aria-current', 'page')
  await switcher.getByRole('link', { name: 'Privacy policy' }).click()
  await expect(page).toHaveURL(/\/legal\/privacy$/)
  await expect(switcher.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('aria-current', 'page')
})

test('the refund policy states that payments are final', async ({ page }) => {
  // Product rule: there are no refunds anywhere on MUN Hub.
  await page.goto('/legal/refunds')
  await expect(page.getByRole('main')).toContainText(/not refundable/i)
  await expect(page.getByRole('main')).not.toContainText(/full refund|refund within|eligible for a refund/i)
  await page.goto('/legal/terms')
  await expect(page.getByRole('main')).toContainText(/no refunds/i)
})

test('a deep link to a curation section scrolls to it', async ({ page }) => {
  await page.goto('/about/curation#review-process')
  await expect(page.locator('#review-process')).toBeInViewport()
})

test('a deep link to a legal section scrolls to it', async ({ page }) => {
  test.fail(
    !process.env.E2E_SHOW_KNOWN_BUGS,
    'BUG: loading /legal/terms#no-refunds directly lands ~270px past the section (its top ends at -268px, scrollY 3457) — the page scrolls, then content above it grows',
  )
  await page.goto('/legal/terms#no-refunds')
  await expect(page.locator('#no-refunds')).toBeInViewport()
})

test.describe('"List your MUN" on the About page', () => {
  test('a signed-out visitor is pointed at organizer signup', async ({ page }) => {
    await page.goto('/about')
    const main = page.getByRole('main')
    await expect(main.getByRole('button', { name: 'Browse conferences' })).toHaveAttribute('href', '/muns')
    const list = main.getByRole('button', { name: /list your mun/i })
    await expect(list).toHaveAttribute('href', /\/organizer\/(signup|apply)$/)
  })

  test('a signed-in delegate is never offered organizer registration', async ({ browser }) => {
    const student = await signUpViaApi()
    const context = await browserContextFor(browser, student)
    const page = await context.newPage()
    await page.goto('/about')
    await expect(pageHeading(page)).toBeVisible()
    await expect(page.getByRole('main').getByRole('button', { name: /list your mun/i })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('link', { name: /list your mun/i })).toHaveCount(0)
    await context.close()
  })
})
