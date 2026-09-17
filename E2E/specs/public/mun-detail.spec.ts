import { expect, test, type Page } from '@playwright/test'
import { getMun, newApiContext } from '../../fixtures/api'
import { MUNS, NONEXISTENT_MUN_SLUG } from '../../fixtures/accounts'
import { CLOSED, OPEN } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'

/**
 * Public MUN detail page (PRD §4), signed out.
 */

const DELEGATE_PASS = OPEN.products[0]
const LIMITED_PASS = OPEN.products[1]
const RETIRED_PASS = OPEN.products[2]
const OXFORD = { slug: 'oxford-mun-2027', name: 'Oxford MUN 2027' }

function main(page: Page) {
  return page.getByRole('main')
}

function passesSection(page: Page) {
  return main(page).locator('section#registration')
}

function passCard(page: Page, name: string) {
  return passesSection(page)
    .locator('div')
    .filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) })
    .last()
}

function committeeCard(page: Page, name: string) {
  return main(page).getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) })
}

function inr(amount: number) {
  return `₹${amount.toLocaleString('en-IN')}`
}

test.describe('open MUN detail', () => {
  test('shows the conference facts: name, organizer, dates, venue, city and status', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const api = await newApiContext()
    const mun = (await getMun(api, OPEN.slug)) as Awaited<ReturnType<typeof getMun>> & { organizerName: string | null }
    await api.dispose()

    await page.goto(`/mun/${OPEN.slug}`)
    await expect(pageHeading(page)).toHaveText(OPEN.name)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    const hero = main(page).locator('section').first()
    await expect(hero).toContainText('Registration open')
    await expect(hero).toContainText('End-to-end testing in a fractured world')
    await expect(hero.getByRole('definition').filter({ hasText: 'E2E Convention Centre' })).toHaveText(
      'E2E Convention Centre, Hyderabad, India',
    )
    // Dates are relative to the fixture reset (~90 days out), so check the shape.
    await expect(hero.getByRole('definition').first()).toHaveText(/^\d{1,2} \w{3} – \d{1,2} \w{3} \d{4}$/)
    await expect(hero).toContainText('2 committees')
    const organizer = mun.organizerName ?? 'Independent organizer'
    await expect(hero).toContainText(`Hosted by ${organizer}`)
    await expect(hero).toContainText(`Registration from ${inr(LIMITED_PASS.price)}`)

    await expect(main(page).getByText('About the organizer')).toBeVisible()
    await expect(main(page).getByRole('heading', { level: 2, name: organizer })).toBeVisible()
    crashes.assertNone()
  })

  test('shows the description', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(main(page).getByRole('heading', { level: 2, name: 'About this conference' })).toBeVisible()
    await expect(main(page)).toContainText(`${OPEN.name} is a fixture conference used by the automated end-to-end test suite.`)
  })

  test('lists every committee with its seats and portfolios', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(main(page).getByRole('heading', { level: 2, name: 'Committees' })).toBeVisible()
    await expect(main(page)).toContainText('2 committees · 5 portfolios')
    for (const committee of OPEN.committees) {
      const cardEl = committeeCard(page, committee.name)
      await expect(cardEl).toBeVisible()
      await expect(cardEl).toContainText(`${committee.capacity} seats`)
      await expect(cardEl).toContainText(`${committee.name} agenda for automated testing.`)
      await expect(cardEl).toContainText(new RegExp(`Portfolios · \\d+ of ${committee.portfolios.length} available`))
      for (const portfolio of committee.portfolios) {
        await expect(cardEl.getByRole('listitem').filter({ hasText: new RegExp(`^${portfolio}$`) })).toBeVisible()
      }
    }
  })

  test('shows both active passes with prices, seat counts and a select button', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(passesSection(page).getByRole('heading', { level: 2, name: 'Registration passes' })).toBeVisible()
    await expect(passesSection(page)).toContainText('Choose a pass to begin registration.')

    for (const pass of [DELEGATE_PASS, LIMITED_PASS]) {
      const cardEl = passCard(page, pass.name)
      await expect(cardEl).toContainText(new RegExp(`${inr(pass.price)}\\s*per delegate`))
      // Other suites may be holding seats, so only the shape and capacity are fixed.
      await expect(cardEl).toContainText(new RegExp(`\\d+ of ${pass.capacity} seats available|All seats taken`))
      await expect(cardEl).toContainText('Confirmed on payment')
    }
    const select = passCard(page, DELEGATE_PASS.name).getByRole('button', { name: `Select ${DELEGATE_PASS.name}` })
    await expect(select).toBeEnabled()
    await expect(select).toHaveAttribute('href', new RegExp(`^/register/${OPEN.slug}\\?product=`))
  })

  test('never shows the inactive pass, on the page or in the API', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(passCard(page, DELEGATE_PASS.name)).toBeVisible()
    await expect(main(page)).not.toContainText(RETIRED_PASS.name)
    await expect(main(page)).not.toContainText(inr(RETIRED_PASS.price))

    const api = await newApiContext()
    const mun = await getMun(api, OPEN.slug)
    expect(mun.registrationProducts.map((p) => p.name)).not.toContain(RETIRED_PASS.name)
    await api.dispose()
  })

  test('"Register now" is enabled and "View passes" jumps to the passes', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    const register = main(page).getByRole('button', { name: 'Register now' })
    await expect(register).toBeEnabled()
    await expect(register).toHaveAttribute('href', `/register/${OPEN.slug}`)

    await main(page).getByRole('button', { name: 'View passes' }).click()
    await expect(page).toHaveURL(/#registration$/)
    await expect(passesSection(page).getByRole('heading', { name: 'Registration passes' })).toBeInViewport()
  })

  test('"Browse all conferences" returns to the marketplace', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await main(page).getByRole('button', { name: 'Browse all conferences' }).click()
    await expect(page).toHaveURL(/\/muns$/)
  })

  test('signed out, "Register now" leads to sign-in and back to the registration', async ({ page }) => {
    await page.goto(`/mun/${OPEN.slug}`)
    await main(page).getByRole('button', { name: 'Register now' }).click()
    await expect(page).toHaveURL(/\/login\?redirectTo=/)
    expect(new URL(page.url()).searchParams.get('redirectTo')).toBe(`/register/${OPEN.slug}`)
    await expect(pageHeading(page)).toHaveText('Welcome back')
    await expect(main(page)).toContainText('Sign in to continue to your registration.')
  })
})

test.describe('MUNs that are not open for registration', () => {
  for (const mun of [
    { slug: CLOSED.slug, name: CLOSED.name },
    { slug: OXFORD.slug, name: OXFORD.name },
  ]) {
    test(`${mun.name}: the register call to action is disabled`, async ({ page }) => {
      await page.goto(`/mun/${mun.slug}`)
      await expect(pageHeading(page)).toHaveText(mun.name)
      await expect(main(page).getByRole('button', { name: 'Register now' })).toHaveCount(0)
      const cta = main(page).getByRole('button', { name: /Registration (not open yet|closed)/ })
      await expect(cta).toBeDisabled()
      await expect(passesSection(page)).toContainText("Registration isn't open for this conference right now.")
      // No pass is selectable.
      await expect(passesSection(page).getByRole('button', { name: /^Select / })).toHaveCount(0)
    })
  }

  test('the closed fixture MUN shows its pass for reference only', async ({ page }) => {
    const pass = CLOSED.products[0]
    await page.goto(`/mun/${CLOSED.slug}`)
    await expect(main(page)).toContainText('Live')
    const cardEl = passCard(page, pass.name)
    await expect(cardEl).toContainText(new RegExp(`${inr(pass.price)}\\s*per delegate`))
    await expect(cardEl.getByRole('button', { name: 'Not yet open' })).toBeDisabled()
  })
})

test.describe('unknown MUN', () => {
  test('an unknown slug renders the not-found page with a way home', async ({ page }) => {
    await page.goto(`/mun/${NONEXISTENT_MUN_SLUG}`)
    await expect(pageHeading(page)).toHaveText('Page not found')
    await expect(page.getByText('The page you requested does not exist.')).toBeVisible()
    await page.getByRole('button', { name: 'Back home' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('the API answers 404 for an unknown slug', async () => {
    const api = await newApiContext()
    expect((await api.get(`muns/${NONEXISTENT_MUN_SLUG}`)).status()).toBe(404)
    await api.dispose()
  })

  test('a seeded published MUN still resolves', async ({ page }) => {
    await page.goto(`/mun/${MUNS.hyderabad.slug}`)
    await expect(pageHeading(page)).toHaveText(MUNS.hyderabad.name)
  })
})
