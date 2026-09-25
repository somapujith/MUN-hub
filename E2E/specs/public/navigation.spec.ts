import { expect, test, type Page } from '@playwright/test'
import { OPEN } from '../../fixtures/fixture-muns'
import { expectSignedOutHeader, headerButton, pageHeading, watchForCrashes } from '../../fixtures/ui'

/**
 * Site chrome for a signed-out visitor: header, footer, 404, theme toggle.
 *
 * The footer's About/Legal columns belong to in-progress work elsewhere and
 * are deliberately not asserted here.
 */

function banner(page: Page) {
  return page.getByRole('banner')
}

function footer(page: Page) {
  return page.getByRole('contentinfo')
}

test.describe('header', () => {
  test('shows the logo, city chooser, search, primary nav, theme toggle and sign-in actions', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/')
    await expect(banner(page).getByRole('link', { name: 'MUN Hub' })).toHaveAttribute('href', '/')
    await expect(banner(page).getByRole('button', { name: 'Choose a city' })).toBeVisible()
    await expect(banner(page).getByRole('searchbox', { name: 'Search MUNs by name or city' })).toBeVisible()

    const primary = banner(page).getByRole('navigation', { name: 'Primary' })
    await expect(primary.getByRole('link')).toHaveCount(1)
    await expect(primary.getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/muns')

    await expect(banner(page).getByRole('button', { name: /switch to (dark|light) theme/i })).toBeVisible()
    await expectSignedOutHeader(page)
    // Organizer entry points are not in the bar.
    await expect(banner(page).getByRole('link', { name: /list your mun/i })).toHaveCount(0)
    await expect(banner(page).getByRole('button', { name: /list your mun/i })).toHaveCount(0)
    crashes.assertNone()
  })

  test('the city chooser only appears on browse pages', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(pageHeading(page)).toHaveText(OPEN.name)
    await expect(banner(page).getByRole('searchbox')).toBeVisible()
    await expect(banner(page).getByRole('button', { name: 'Choose a city' })).toHaveCount(0)
  })

  test('"Marketplace" opens /muns and the logo returns home', async ({ page }) => {
    await page.goto('/')
    await banner(page).getByRole('link', { name: 'Marketplace' }).click()
    await expect(page).toHaveURL(/\/muns$/)
    await expect(pageHeading(page)).toHaveText('Find your next Model UN')

    await page.goto(`/mun/${OPEN.slug}`)
    await banner(page).getByRole('link', { name: 'MUN Hub', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(pageHeading(page)).toHaveText(/Model UN conferences/)
  })

  test('"Sign in" and "Create account" lead to their pages', async ({ page }) => {
    await page.goto('/muns')
    await headerButton(page, /^sign in$/i).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(pageHeading(page)).toHaveText('Welcome back')

    await headerButton(page, /^create account$/i).click()
    await expect(page).toHaveURL(/\/signup$/)
    await expect(pageHeading(page)).toHaveText('Create your account')
  })

  test('the theme toggle switches theme, flips its label and survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    const html = page.locator('html')
    const toDark = banner(page).getByRole('button', { name: 'Switch to dark theme' })
    await expect(toDark).toBeVisible()
    await expect(html).not.toHaveClass(/\bdark\b/)

    await toDark.click()
    const toLight = banner(page).getByRole('button', { name: 'Switch to light theme' })
    await expect(toLight).toBeVisible()
    await expect(html).toHaveClass(/\bdark\b/)

    await page.reload()
    await expect(banner(page).getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
    await expect(html).toHaveClass(/\bdark\b/)

    await banner(page).getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(banner(page).getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
    await expect(html).not.toHaveClass(/\bdark\b/)
  })
})

test.describe('footer', () => {
  test('the marketplace column links all resolve', async ({ page }) => {
    await page.goto('/')
    const column = footer(page).getByRole('navigation', { name: 'Marketplace' })
    await expect(column.getByRole('heading', { name: 'Marketplace' })).toBeVisible()
    const expected = [
      ['Browse all MUNs', '/muns'],
      ['Upcoming conferences', '/muns?sortBy=date'],
      ['Recently added', '/muns?sortBy=newest'],
      ['Lowest delegate fee', '/muns?sortBy=price'],
    ] as const
    for (const [name, href] of expected) {
      await expect(column.getByRole('link', { name })).toHaveAttribute('href', href)
    }
    for (const [name, href] of expected) {
      await page.goto('/')
      await footer(page).getByRole('navigation', { name: 'Marketplace' }).getByRole('link', { name }).click()
      await expect(page).toHaveURL(new RegExp(`${href.replace('?', '\\?')}$`))
      await expect(pageHeading(page)).toHaveText('Find your next Model UN')
      await expect(page.getByRole('region', { name: 'Search results' }).getByRole('article').first()).toBeVisible()
    }
  })

  test('the organizer column offers "List your MUN" to a signed-out visitor, pointing at the organizer login', async ({
    page,
  }) => {
    await page.goto('/')
    const column = footer(page).getByRole('navigation', { name: 'For organizers' })
    await expect(column).toBeVisible()
    const link = column.getByRole('link', { name: 'List your MUN' })
    await expect(link).toHaveAttribute('href', '/organizer/login')
    await link.click()
    await expect(page).toHaveURL(/\/organizer\/login$/)
    await expect(pageHeading(page)).toHaveText('Log in')
  })

  test('the footer logo returns home', async ({ page }) => {
    await page.goto('/muns')
    await footer(page).getByRole('link', { name: 'MUN Hub', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('"List your MUN" for signed-out visitors', () => {
  test('the home page pitch points at the organizer login', async ({ page }) => {
    await page.goto('/')
    const cta = page.getByRole('main').getByRole('button', { name: 'List your MUN' })
    await expect(cta).toHaveAttribute('href', '/organizer/login')
    await cta.click()
    await expect(page).toHaveURL(/\/organizer\/login$/)
    await expect(pageHeading(page)).toHaveText('Log in')
  })
})

test.describe('not found', () => {
  test('an unknown route shows the 404 page with a way home', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/definitely-not-a-route-e2e')
    await expect(pageHeading(page)).toHaveText("We couldn't find that page")
    await expect(page.getByText('The link may be mistyped')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse conferences' })).toHaveAttribute('href', '/muns')
    await page.getByRole('button', { name: 'Back to home' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(pageHeading(page)).toHaveText(/Model UN conferences/)
    crashes.assertNone()
  })

  test('a deep unknown route is also a 404', async ({ page }) => {
    await page.goto('/muns/extra/segments')
    await expect(pageHeading(page)).toHaveText("We couldn't find that page")
  })
})

test.describe('document titles', () => {
  for (const [path, title] of [
    ['/', 'MUN Hub — Discover and Register for Model United Nations Conferences'],
    ['/muns', 'Browse MUNs | MUN Hub'],
    ['/login', 'Sign in | MUN Hub'],
    ['/signup', 'Create an account | MUN Hub'],
  ] as const) {
    test(`${path} has the title "${title}"`, async ({ page }) => {
      await page.goto(path)
      await expect(pageHeading(page)).toBeVisible()
      await expect(page).toHaveTitle(title)
    })
  }

  test('a MUN page is titled after the MUN', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(pageHeading(page)).toHaveText(OPEN.name)
    await expect(page).toHaveTitle(`${OPEN.name} | MUN Hub`)
  })
})
