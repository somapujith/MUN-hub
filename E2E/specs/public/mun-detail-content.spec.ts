import { expect, test, type Page } from '@playwright/test'
import { MUNS } from '../../fixtures/accounts'
import { newApiContext } from '../../fixtures/api'
import { SANDBOX } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'

/**
 * The full public MUN page (186b22b): section nav, key facts, committees,
 * executive board, schedule, accommodation, documents, contact, passes, and
 * SEO tags. Uses the seeded Oxford MUN 2027, which has demo data for every
 * section (lib/db/seed-go-live-modules.ts). Read-only.
 */

const OXFORD = MUNS.open // seeded Oxford MUN 2027 (published, not open yet)

const SECTIONS: Array<[string, string]> = [
  ['Overview', 'about'],
  ['Committees', 'committees'],
  ['Executive board', 'executive-board'],
  ['Schedule', 'schedule'],
  ['Accommodation', 'accommodation'],
  ['Documents', 'documents'],
  ['Contact', 'contact'],
  ['Passes', 'registration'],
]

function main(page: Page) {
  return page.getByRole('main')
}

test('every section is on the page, and the section nav jumps to each', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await page.goto(`/mun/${OXFORD.slug}`)
  await expect(pageHeading(page)).toHaveText(OXFORD.name)
  const nav = page.getByRole('navigation', { name: 'On this page' })
  await expect(nav.getByRole('link')).toHaveText(SECTIONS.map(([label]) => label))

  for (const [label, id] of SECTIONS) {
    const section = page.locator(`section#${id}`)
    await expect(section, id).toBeAttached()
    await nav.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#${id}$`))
    await expect(section).toBeInViewport()
  }
  crashes.assertNone()
})

test('the sections carry the conference’s real content', async ({ page }) => {
  await page.goto(`/mun/${OXFORD.slug}`)
  await expect(main(page).getByRole('heading', { level: 2, name: 'Key facts' })).toBeVisible()
  await expect(main(page).getByRole('heading', { level: 2, name: 'About this conference' })).toBeVisible()

  const committees = page.locator('section#committees')
  for (const name of ['UNSC', 'UNHRC']) await expect(committees.getByRole('heading', { level: 3, name })).toBeVisible()

  const board = page.locator('section#executive-board')
  await expect(board.getByRole('heading', { level: 3, name: 'Secretariat' })).toBeVisible()

  const schedule = page.locator('section#schedule')
  await expect(schedule.getByRole('heading', { level: 3, name: /^Day 1 · / })).toBeVisible()

  const documents = page.locator('section#documents')
  const downloads = documents.getByRole('link', { name: /^Download / })
  await expect(downloads.first()).toBeVisible()
  for (const href of await downloads.evaluateAll((links) => links.map((a) => a.getAttribute('href')))) {
    expect(href).toMatch(/\.pdf$/)
  }
  // No refunds anywhere in the product, so no refund policy to download.
  await expect(documents.getByRole('link', { name: /refund/i })).toHaveCount(0)

  const contact = page.locator('section#contact')
  await expect(contact.getByRole('link', { name: /@/ })).toHaveAttribute('href', /^mailto:/)
  await expect(contact.getByRole('link', { name: /^\+91/ })).toHaveAttribute('href', /^tel:\+91/)

  await expect(page.locator('section#registration')).toContainText(/Delegate/)
  await expect(main(page).getByRole('img', { name: `${OXFORD.name} logo` })).toBeVisible()
})

test('the page is described for search engines and link previews', async ({ page }) => {
  await page.goto(`/mun/${OXFORD.slug}`)
  await expect(page).toHaveTitle(`${OXFORD.name} | MUN Hub`)
  const meta = (key: string) => page.locator(`meta[property="${key}"], meta[name="${key}"]`)
  await expect(meta('description')).toHaveAttribute('content', /\S{10,}/)
  await expect(meta('og:title')).toHaveAttribute('content', `${OXFORD.name} | MUN Hub`)
  await expect(meta('og:type')).toHaveAttribute('content', 'website')
  await expect(meta('og:url')).toHaveAttribute('content', new RegExp(`/mun/${OXFORD.slug}$`))
  await expect(meta('og:image')).toHaveAttribute('content', /^https?:\/\//)
  await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/mun/${OXFORD.slug}$`))

  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}')
  expect(ld).toMatchObject({ '@context': 'https://schema.org', '@type': 'Event', name: OXFORD.name })
  expect(ld.startDate).toBeTruthy()
})

test('the public API returns only public fields', async () => {
  const api = await newApiContext()
  const res = await api.get(`muns/${OXFORD.slug}`)
  expect(res.status()).toBe(200)
  const mun = await res.json()
  for (const key of ['organizerId', 'createdAt', 'updatedAt', 'publishedAt']) expect(mun, key).not.toHaveProperty(key)
  if (mun.contact) {
    for (const key of Object.keys(mun.contact)) expect(['officialEmail', 'phone', 'website']).toContain(key)
  }
  expect(JSON.stringify(mun)).not.toMatch(/passwordHash|ciphertext/i)

  const faqs = await api.get(`muns/${mun.id}/faqs`)
  expect(faqs.status()).toBe(200)
  expect(Array.isArray(await faqs.json())).toBe(true)
  await api.dispose()
})

test('hidden MUNs stay hidden, and search never returns non-public statuses', async () => {
  const api = await newApiContext()
  expect((await api.get(`muns/${SANDBOX.slug}`)).status()).toBe(404)
  for (const status of ['DRAFT', 'ONBOARDING', 'UNPUBLISHED', 'SUSPENDED', 'CANCELLED']) {
    const list = await (await api.get(`muns?status=${status}`)).json()
    expect(list, status).toMatchObject({ results: [], total: 0 })
  }
  await api.dispose()
})

test('the search API filters by conference dates and can sort by deadline', async () => {
  const api = await newApiContext()
  const from = new Date(Date.now() + 80 * 86_400_000)
  const to = new Date(Date.now() + 100 * 86_400_000)
  const res = await api.get(`muns?dateFrom=${from.toISOString()}&dateTo=${to.toISOString()}&limit=100`)
  expect(res.status()).toBe(200)
  const { results } = (await res.json()) as { results: Array<{ startDate: string; endDate: string | null }> }
  for (const mun of results) {
    const start = new Date(mun.startDate).getTime()
    const end = new Date(mun.endDate ?? mun.startDate).getTime()
    expect(start <= to.getTime() && end >= from.getTime(), JSON.stringify(mun)).toBe(true)
  }

  const byDeadline = await api.get('muns?sortBy=deadline&limit=20')
  expect(byDeadline.status()).toBe(200)
  expect((await api.get('muns?sortBy=cheapest')).status()).toBe(400)
  await api.dispose()
})

test('the not-found page keeps the site header and footer', async ({ page }) => {
  await page.goto('/mun/definitely-not-a-real-mun-e2e')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
})
