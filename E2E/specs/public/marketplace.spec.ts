import { expect, test, type Page } from '@playwright/test'
import { newApiContext } from '../../fixtures/api'
import { NONEXISTENT_MUN_SLUG } from '../../fixtures/accounts'
import { CLOSED, OPEN, REVIEW, SANDBOX } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'

/**
 * Discovery (PRD §3): home page, /muns search, city filter, sort, empty
 * state, and card → detail navigation. Signed out throughout.
 *
 * The local database carries many published test MUNs, so assertions that
 * need a specific fixture MUN narrow the list by search rather than assuming
 * it lands on page 1.
 */

function main(page: Page) {
  return page.getByRole('main')
}

/** The home page's "Registration open now" row has cards, and every card in it is open for registration. */
async function expectOnlyOpenMunsInRow(page: Page) {
  const row = main(page).getByRole('list', { name: 'Registration open now' })
  const cards = row.getByRole('listitem')
  await expect(cards.first()).toBeVisible()
  const count = await cards.count()
  for (let i = 0; i < count; i += 1) await expect(cards.nth(i)).toContainText('Registration open')
}

function results(page: Page) {
  return main(page).getByRole('region', { name: 'Search results' })
}

// The result-count heading comes first; an empty state adds its own h2.
function resultsHeading(page: Page) {
  return results(page).getByRole('heading', { level: 2 }).first()
}

function card(page: Page, name: string) {
  return results(page).getByRole('article').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) })
}

async function searchFromMarketplace(page: Page, term: string) {
  const box = main(page).getByRole('searchbox', { name: 'Search MUNs by name, city, theme or organizer' })
  await box.fill(term)
  await main(page).getByRole('button', { name: /^search$/i }).click()
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(term).replace(/%20/g, '(\\+|%20)')}`))
}

test.describe('home page', () => {
  test('renders the featured carousel, the listing rows and the closing calls to action', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/')

    await expect(pageHeading(page)).toHaveText(/Model UN conferences/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(main(page).getByRole('region', { name: 'Featured conferences' })).toBeVisible()
    await expect(main(page).getByRole('heading', { level: 2, name: 'Registration open now' })).toBeVisible()
    // The row is capped, and the local database holds many open MUNs, so
    // assert what every card in it has in common rather than which ones made the cut.
    await expectOnlyOpenMunsInRow(page)
    // "See all" opens the matching /muns view (186b22b).
    await expect(main(page).getByRole('link', { name: /see all registration open now/i })).toHaveAttribute(
      'href',
      '/muns?status=REGISTRATION_OPEN',
    )
    // Signed-out visitors get the organizer pitch.
    await expect(main(page).getByText('List your conference where delegates are already looking.')).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'List your MUN' })).toBeVisible()
    await expect(main(page).getByText('Your next placard is one search away.')).toBeVisible()

    await main(page).getByRole('button', { name: 'Browse MUNs' }).click()
    await expect(page).toHaveURL(/\/muns$/)
    await expect(pageHeading(page)).toHaveText('Find your next Model UN')
    crashes.assertNone()
  })

  test('never lists a MUN that is not public', async ({ page }) => {
    await page.goto('/')
    await expectOnlyOpenMunsInRow(page)
    await expect(main(page)).not.toContainText(SANDBOX.name)
    await expect(main(page)).not.toContainText(REVIEW.name)
  })
})

test.describe('/muns marketplace', () => {
  test('lists published MUNs with a result count', async ({ page }) => {
    await page.goto('/muns')
    await expect(pageHeading(page)).toHaveText('Find your next Model UN')
    await expect(resultsHeading(page)).toHaveText(/^\d+ conferences?/)
    await expect(results(page).getByRole('article').first()).toBeVisible()
  })

  test('the open fixture MUN is listed and the onboarding sandbox MUN is not', async ({ page }) => {
    await page.goto('/muns?q=E2E')
    await expect(card(page, OPEN.name)).toBeVisible()
    await expect(card(page, CLOSED.name)).toBeVisible()
    await expect(results(page)).not.toContainText(SANDBOX.name)

    await page.goto(`/muns?q=${encodeURIComponent(SANDBOX.name)}`)
    await expect(resultsHeading(page)).toHaveText(/No conferences/)
  })

  test('the API never returns the onboarding sandbox MUN either', async () => {
    const api = await newApiContext()
    const list = await (await api.get(`muns?query=${encodeURIComponent('E2E')}&limit=100`)).json()
    const slugs = (list.results as Array<{ slug: string }>).map((m) => m.slug)
    expect(slugs).toContain(OPEN.slug)
    expect(slugs).not.toContain(SANDBOX.slug)
    expect((await api.get(`muns/${SANDBOX.slug}`)).status()).toBe(404)
    await api.dispose()
  })

  test('search finds a MUN by name', async ({ page }) => {
    await page.goto('/muns')
    await searchFromMarketplace(page, OPEN.name)
    await expect(card(page, OPEN.name)).toBeVisible()
    await expect(resultsHeading(page)).toContainText(`matching “${OPEN.name}”`)
    // The query stays in the box so it can be refined.
    await expect(main(page).getByRole('searchbox')).toHaveValue(OPEN.name)
  })

  test('search finds MUNs by city', async ({ page }) => {
    await page.goto('/muns')
    await searchFromMarketplace(page, 'Hyderabad')
    const cards = results(page).getByRole('article')
    await expect(cards.first()).toBeVisible()
    // Search also matches the organizer's name and institution (186b22b), so
    // not every hit is located in Hyderabad, but the first page has some that are.
    expect((await cards.allTextContents()).some((text) => /Hyderabad/.test(text))).toBe(true)

    // The fixture MUN (city Hyderabad, name without it) is matched by city,
    // though it may sit past page 1 among the many local test MUNs.
    const api = await newApiContext()
    const slugs: string[] = []
    for (let offset = 0; ; offset += 100) {
      const list = await (await api.get(`muns?query=Hyderabad&limit=100&offset=${offset}`)).json()
      slugs.push(...(list.results as Array<{ slug: string }>).map((m) => m.slug))
      if (offset + 100 >= list.total) break
    }
    expect(slugs).toContain(OPEN.slug)
    await api.dispose()
  })

  test('the header search box searches from any page', async ({ page }) => {
    await page.goto('/forgot-password')
    const box = page.getByRole('banner').getByRole('searchbox', { name: 'Search MUNs by name or city' })
    await box.fill(OPEN.name)
    await box.press('Enter')
    await expect(page).toHaveURL(/\/muns\?q=/)
    await expect(card(page, OPEN.name)).toBeVisible()
  })

  test('a search with no results shows an empty state that clears the filters', async ({ page }) => {
    const nonsense = 'zzqx-no-such-conference-e2e'
    await page.goto(`/muns?q=${nonsense}`)
    await expect(resultsHeading(page)).toContainText('No conferences')
    await expect(results(page)).toContainText('No conferences match those filters')
    await expect(results(page)).toContainText(`Nothing matched "${nonsense}"`)
    await expect(results(page).getByRole('article')).toHaveCount(0)

    await results(page).getByRole('button', { name: 'Clear all filters' }).click()
    await expect(page).toHaveURL(/\/muns$/)
    await expect(results(page).getByRole('article').first()).toBeVisible()
  })

  test('the city chooser filters the list to that city', async ({ page }) => {
    const api = await newApiContext()
    const facets = (await (await api.get('muns/facets')).json()) as { cities: string[] }
    await api.dispose()
    expect(facets.cities).toContain('Hyderabad')
    const otherCity = facets.cities.find((c) => c !== 'Hyderabad')

    await page.goto('/muns')
    await page.getByRole('banner').getByRole('button', { name: 'Choose a city' }).click()
    await page.getByRole('menuitemradio', { name: 'Hyderabad' }).click()
    await expect(page).toHaveURL(/[?&]city=Hyderabad/)
    await expect(resultsHeading(page)).toContainText('in Hyderabad')
    await expect(page.getByRole('banner').getByRole('button', { name: 'City: Hyderabad. Change city' })).toBeVisible()
    for (const text of await results(page).getByRole('article').allTextContents()) expect(text).toMatch(/Hyderabad/)

    if (otherCity) {
      await page.goto(`/muns?city=${encodeURIComponent(otherCity)}&q=E2E`)
      await expect(resultsHeading(page)).toContainText(`in ${otherCity}`)
      await expect(card(page, OPEN.name)).toHaveCount(0)
    }

    // "All cities" removes the filter again.
    await page.goto('/muns?city=Hyderabad')
    await page.getByRole('banner').getByRole('button', { name: 'City: Hyderabad. Change city' }).click()
    await page.getByRole('menuitemradio', { name: 'All cities' }).click()
    await expect(page).not.toHaveURL(/city=/)
  })

  test('a search keeps the chosen city', async ({ page }) => {
    await page.goto('/muns?city=Hyderabad')
    await searchFromMarketplace(page, OPEN.name)
    await expect(page).toHaveURL(/city=Hyderabad/)
    await expect(card(page, OPEN.name)).toBeVisible()
  })

  for (const [sortBy, label] of [
    ['date', 'Conference date'],
    ['newest', 'Newly listed'],
    ['price', 'Lowest fee'],
  ] as const) {
    test(`sort by ${sortBy} loads and is marked active`, async ({ page }) => {
      const crashes = watchForCrashes(page)
      await page.goto(`/muns?sortBy=${sortBy}`)
      await expect(results(page).getByRole('article').first()).toBeVisible()
      const rail = main(page).getByRole('complementary', { name: 'Filter MUNs' })
      await expect(rail.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
      crashes.assertNone()
    })
  }

  test('choosing a sort from the rail updates the URL', async ({ page }) => {
    await page.goto('/muns')
    const rail = main(page).getByRole('complementary', { name: 'Filter MUNs' })
    await rail.getByRole('button', { name: 'Lowest fee' }).click()
    await expect(page).toHaveURL(/sortBy=price/)
    await rail.getByRole('button', { name: 'Newly listed' }).click()
    await expect(page).toHaveURL(/sortBy=newest/)
    await rail.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(page).toHaveURL(/\/muns$/)
  })

  test('price sort really orders by the lowest fee', async () => {
    const api = await newApiContext()
    const list = await (await api.get('muns?sortBy=price&limit=50')).json()
    const prices = (list.results as Array<{ minPrice: number | null }>)
      .map((m) => m.minPrice)
      .filter((p): p is number => p !== null)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    await api.dispose()
  })

  test('a card opens that MUN’s detail page', async ({ page }) => {
    await page.goto(`/muns?q=${encodeURIComponent(OPEN.name)}`)
    await card(page, OPEN.name).getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/mun/${OPEN.slug}$`))
    await expect(pageHeading(page)).toHaveText(OPEN.name)
  })

  test('a card shows location, status, organizer and the lowest fee', async ({ page }) => {
    await page.goto(`/muns?q=${encodeURIComponent(OPEN.name)}`)
    const openCard = card(page, OPEN.name)
    await expect(openCard).toContainText('Hyderabad, India')
    await expect(openCard).toContainText('Registration open')
    await expect(openCard).toContainText('₹999')
    await expect(openCard).not.toContainText('₹500') // the inactive pass never sets the "from" price
  })

  test('an unknown MUN slug from a stale link renders not-found', async ({ page }) => {
    await page.goto(`/mun/${NONEXISTENT_MUN_SLUG}`)
    await expect(pageHeading(page)).toHaveText("We couldn't find that page")
  })
})
