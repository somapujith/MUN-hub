import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { getMun } from '../../fixtures/api'
import { MUNS } from '../../fixtures/accounts'
import { CLOSED, OPEN, SANDBOX } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import {
  anonApi,
  main,
  openSection,
  organizerApi,
  ownedMunBySlug,
  ownedMuns,
  sandboxId,
  sectionPath,
  type OwnedMun,
} from './_helpers'

/**
 * Organizer Dashboard PRD: the org-wide workspace (Overview, My MUNs) and the
 * per-MUN workspace shell (switcher, breadcrumb, 16 sections).
 */

const OXFORD = MUNS.open // seeded Oxford MUN 2027, owned by the seeded organizer

const SECTIONS: Array<{ segment: string; heading: string | RegExp; navLabel: string }> = [
  { segment: 'setup', heading: 'MUN Setup', navLabel: 'MUN Setup' },
  { segment: 'committees', heading: 'Committees', navLabel: 'Committees & Portfolios' },
  { segment: 'executive-board', heading: 'Executive Board', navLabel: 'Executive Board' },
  { segment: 'products', heading: 'Registration Products', navLabel: 'Registration Products' },
  { segment: 'form', heading: 'Registration Form', navLabel: 'Registration Form' },
  { segment: 'accommodation', heading: 'Accommodation', navLabel: 'Accommodation' },
  { segment: 'registrations', heading: 'Registrations', navLabel: 'Registrations' },
  { segment: 'finance', heading: 'Payments & Finance', navLabel: 'Payments & Finance' },
  { segment: 'communications', heading: 'Communications', navLabel: 'Communications' },
  { segment: 'documents', heading: 'Documents', navLabel: 'Documents & Media' },
  { segment: 'conference-day', heading: /^Conference day$/i, navLabel: 'Conference Day' },
  { segment: 'results', heading: 'Results & Awards', navLabel: 'Results & Awards' },
  { segment: 'certificates', heading: 'Certificates', navLabel: 'Certificates' },
  { segment: 'analytics', heading: 'Analytics', navLabel: 'Analytics' },
  { segment: 'team', heading: 'Team & Permissions', navLabel: 'Team & Permissions' },
  { segment: 'settings', heading: 'Settings', navLabel: 'Settings' },
]

let api: APIRequestContext
let muns: OwnedMun[]
let sandbox: string

test.beforeAll(async () => {
  api = await organizerApi()
  muns = await ownedMuns(api)
  sandbox = await sandboxId(api)
})

test.afterAll(async () => {
  await api?.dispose()
})

function sidebar(page: Page) {
  return page.getByRole('complementary').filter({ has: page.getByRole('navigation', { name: 'Organizer workspace' }) })
}

function breadcrumb(page: Page) {
  return page.getByRole('navigation', { name: 'Breadcrumb' })
}

function idOf(slug: string): string {
  const mun = muns.find((m) => m.slug === slug)
  if (!mun) throw new Error(`organizer does not own ${slug}`)
  return mun.id
}

test.describe('org-wide workspace', () => {
  test('overview shows totals and every conference the organizer runs', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/organizer/dashboard')
    await expect(pageHeading(page)).toHaveText('Overview')
    for (const label of ['Registrations', 'Confirmed', 'Pending payment', 'Seats available']) {
      await expect(main(page).getByText(label, { exact: true })).toBeVisible()
    }
    await expect(main(page).getByText(/Capacity utilisation: \d+%/)).toBeVisible()

    const conferences = main(page).getByRole('listitem')
    for (const name of [OPEN.name, SANDBOX.name, CLOSED.name, OXFORD.name]) {
      await expect(conferences.filter({ hasText: name })).toHaveCount(1)
    }
    await expect(conferences.filter({ hasText: OPEN.name })).toContainText('Registration open')
    await expect(conferences.filter({ hasText: CLOSED.name })).toContainText('Live')
    // Only the organizer's own conferences are listed.
    await expect(conferences).toHaveCount(muns.length)
    await expect(main(page)).not.toContainText(MUNS.published.name)

    await expect(breadcrumb(page)).toContainText('Overview')
    crashes.assertNone()
  })

  test('overview rows lead to each MUN\'s next step (4e62a1d)', async ({ page }) => {
    await page.goto('/organizer/dashboard')
    const cta = (row: ReturnType<Page['getByTestId']>, name: string) =>
      row.getByRole('link', { name }).or(row.getByRole('button', { name }))

    const sandboxRow = page.getByTestId(`overview-mun-${sandbox}`)
    await expect(sandboxRow).toContainText(SANDBOX.name)
    await expect(cta(sandboxRow, 'Continue setup')).toHaveAttribute('href', sectionPath(sandbox, 'setup'))

    const open = idOf(OPEN.slug)
    const openRow = page.getByTestId(`overview-mun-${open}`)
    await expect(cta(openRow, 'View registrations')).toHaveAttribute('href', sectionPath(open, 'registrations'))
    // "Manage" is still the fallback for a few statuses (e.g. VERIFIED,
    // GO_LIVE_QUEUE), and this organizer owns other fixture MUNs that cycle
    // through those in other specs — don't assert a page-wide count.
    await expect(sandboxRow.getByRole('button', { name: /^manage$/i })).toHaveCount(0)
    await expect(openRow.getByRole('button', { name: /^manage$/i })).toHaveCount(0)
  })

  test('My MUNs lists each conference with its status and registration counts', async ({ page }) => {
    await page.goto('/organizer/dashboard/muns')
    await expect(pageHeading(page)).toHaveText('My MUNs')

    for (const [slug, name] of [
      [OPEN.slug, OPEN.name],
      [SANDBOX.slug, SANDBOX.name],
      [CLOSED.slug, CLOSED.name],
      [OXFORD.slug, OXFORD.name],
    ]) {
      const card = main(page).getByRole('link', { name: new RegExp(`^${name}`) })
      await expect(card).toHaveAttribute('href', sectionPath(idOf(slug), 'setup'))
      await expect(card).toContainText(/\d+ registrations · \d+ confirmed/)
    }
    await expect(main(page).getByRole('link', { name: new RegExp(`^${OPEN.name}`) })).toContainText('Registration open')
    // Submitting the sandbox for review (go-live.spec) legitimately moves it to "Action required".
    await expect(main(page).getByRole('link', { name: new RegExp(`^${SANDBOX.name}`) })).toContainText(
      /Onboarding|Action required/,
    )
    await expect(main(page).getByRole('link', { name: new RegExp(`^${CLOSED.name}`) })).toContainText('Live')

    const open = await ownedMunBySlug(api, OPEN.slug)
    await expect(main(page).getByRole('link', { name: new RegExp(`^${OPEN.name}`) })).toContainText(
      `${open.registrationCount} registrations · ${open.confirmedCount} confirmed`,
    )
  })

  test('the sidebar and breadcrumb navigate between Overview and My MUNs', async ({ page }) => {
    await page.goto('/organizer/dashboard')
    await sidebar(page).getByRole('link', { name: 'My MUNs' }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard\/muns$/)
    await expect(pageHeading(page)).toHaveText('My MUNs')
    await expect(breadcrumb(page).getByRole('listitem')).toHaveText(['Overview', 'My MUNs'])

    await breadcrumb(page).getByRole('link', { name: 'Overview' }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
    await expect(pageHeading(page)).toHaveText('Overview')
  })

  test('"Host a MUN" opens the host-another-MUN page', async ({ page }) => {
    await page.goto('/organizer/dashboard/muns')
    await main(page).getByRole('button', { name: 'Host a MUN' }).click()
    // The seeded organizer has finished onboarding, so it gets the form (or,
    // if an earlier run left an application under review, the waiting notice).
    await expect(page).toHaveURL(/\/organizer\/apply$/)
    await expect(pageHeading(page)).toHaveText(/^Host another MUN$|is being reviewed$/)
  })

  test('the conference switcher offers only the organizer\'s own conferences', async ({ page }) => {
    await page.goto('/organizer/dashboard')
    await sidebar(page).getByRole('button', { name: 'Choose a conference' }).click()
    const menu = page.getByRole('menu')
    for (const name of [OPEN.name, SANDBOX.name, CLOSED.name, OXFORD.name]) {
      await expect(menu.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible()
    }
    // Only real conferences: never placeholder/mock ones the organizer doesn't run.
    await expect(menu.getByRole('menuitem')).toHaveCount(muns.length + 1)
    await expect(menu.getByRole('menuitem', { name: /apply to host another mun/i })).toBeVisible()
  })

  test('signed-out visitors are sent to the organizer login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    await page.goto(sectionPath(sandbox, 'committees'))
    await expect(page).toHaveURL(/\/organizer\/login\?redirectTo=/)
    await context.close()
  })
})

test.describe('per-MUN workspace shell', () => {
  for (const section of SECTIONS) {
    test(`the "${section.segment}" section opens for the sandbox`, async ({ page }) => {
      const crashes = watchForCrashes(page)
      await openSection(page, sandbox, section.segment, section.heading)
      await expect(pageHeading(page)).toHaveCount(1)
      await expect(sidebar(page).getByRole('link', { name: section.navLabel })).toHaveAttribute(
        'href',
        sectionPath(sandbox, section.segment),
      )
      await expect(breadcrumb(page).getByRole('listitem')).toHaveText(['Overview', SANDBOX.name, /.+/])
      // Nothing on the page may report a failed load.
      await expect(main(page).getByText(/forbidden|internal server error|not found/i)).toHaveCount(0)
      crashes.assertNone()
    })
  }

  test('the MUN index route redirects to its setup section', async ({ page }) => {
    await page.goto(`/organizer/dashboard/${sandbox}`)
    await expect(page).toHaveURL(new RegExp(`${sectionPath(sandbox, 'setup')}$`))
    await expect(pageHeading(page)).toHaveText('MUN Setup')
  })

  test('sidebar links move between sections and the breadcrumb follows', async ({ page }) => {
    await openSection(page, sandbox, 'setup', 'MUN Setup')
    await expect(breadcrumb(page).getByRole('listitem')).toHaveText(['Overview', SANDBOX.name, 'MUN Setup'])

    await sidebar(page).getByRole('link', { name: 'Registration Products' }).click()
    await expect(page).toHaveURL(new RegExp(`${sectionPath(sandbox, 'products')}$`))
    await expect(pageHeading(page)).toHaveText('Registration Products')
    await expect(breadcrumb(page).getByRole('listitem')).toHaveText(['Overview', SANDBOX.name, 'Registration Products'])

    await breadcrumb(page).getByRole('link', { name: SANDBOX.name }).click()
    await expect(page).toHaveURL(new RegExp(`${sectionPath(sandbox, 'setup')}$`))
    await breadcrumb(page).getByRole('link', { name: 'Overview' }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
  })

  test('the switcher jumps to the same section of another conference', async ({ page }) => {
    await openSection(page, sandbox, 'committees', 'Committees & Portfolios')
    const switcher = sidebar(page).getByRole('button', { name: `Conference: ${SANDBOX.name}. Switch conference` })
    await switcher.click()
    await page.getByRole('menu').getByRole('menuitem', { name: new RegExp(OPEN.name) }).click()

    await expect(page).toHaveURL(new RegExp(`${sectionPath(idOf(OPEN.slug), 'committees')}$`))
    await expect(pageHeading(page)).toHaveText('Committees & Portfolios')
    await expect(main(page).getByRole('heading', { name: OPEN.committees[0].name })).toBeVisible()
    await expect(sidebar(page).getByRole('button', { name: `Conference: ${OPEN.name}. Switch conference` })).toBeVisible()
  })
})

test.describe('tenant isolation', () => {
  let vitMunId: string
  let vitCommitteeId: string
  let vitProductId: string

  test.beforeAll(async () => {
    const anon = await anonApi()
    const vit = await getMun(anon, MUNS.published.slug)
    vitMunId = vit.id
    vitCommitteeId = vit.committees[0].id
    vitProductId = vit.registrationProducts[0].id
    await anon.dispose()
  })

  test('opening another organizer\'s MUN never shows its data', async ({ page }) => {
    for (const segment of ['setup', 'registrations', 'finance']) {
      await page.goto(sectionPath(vitMunId, segment))
      await expect(main(page)).toBeVisible()
      await expect(main(page)).not.toContainText(MUNS.published.name)
      await expect(main(page).getByRole('textbox', { name: 'Conference name' })).toHaveCount(0)
    }
  })

  test('the API refuses to show another organizer\'s MUN data', async () => {
    for (const path of [
      `organizer/muns/${vitMunId}/details`,
      `organizer/muns/${vitMunId}/overview`,
      `organizer/muns/${vitMunId}/delegates`,
      `organizer/muns/${vitMunId}/analytics`,
      `organizer/muns/${vitMunId}/achievements`,
      `muns/${vitMunId}/payment-settings`,
      `muns/${vitMunId}/progress`,
      `muns/${vitMunId}/executive-board/manage`,
      `muns/${vitMunId}/certificates`,
    ]) {
      const res = await api.get(path)
      expect(res.status(), `GET ${path}`).toBe(403)
    }
  })

  test('the API refuses the organizer\'s writes to another organizer\'s MUN', async () => {
    const writes: Array<[string, string, unknown]> = [
      ['PATCH', `muns/${vitMunId}`, { theme: 'E2E cross-tenant write — must be refused' }],
      ['POST', `muns/${vitMunId}/committees`, { name: 'E2E cross-tenant committee', capacity: 10 }],
      ['PATCH', `committees/${vitCommitteeId}`, { agenda: 'E2E cross-tenant write' }],
      ['POST', `committees/${vitCommitteeId}/portfolios`, { name: 'E2E cross-tenant portfolio' }],
      ['POST', `muns/${vitMunId}/products`, { name: 'E2E cross-tenant pass', price: 1, capacity: 1 }],
      ['PATCH', `products/${vitProductId}`, { price: 1 }],
      ['POST', `muns/${vitMunId}/form-fields`, { fieldKey: 'e2e_cross_tenant', fieldType: 'SHORT_TEXT', label: 'x' }],
      ['POST', `muns/${vitMunId}/executive-board`, { name: 'E2E cross-tenant chair', role: 'CHAIR' }],
      ['POST', `muns/${vitMunId}/schedule`, {
        title: 'E2E cross-tenant session',
        kind: 'OTHER',
        startsAt: '2027-01-01T10:00:00Z',
        endsAt: '2027-01-01T11:00:00Z',
      }],
      ['PUT', `muns/${vitMunId}/contact`, {
        officialEmail: 'e2e@example.com',
        contactPersonName: 'E2E',
        contactPersonEmail: 'e2e@example.com',
      }],
      ['POST', `muns/${vitMunId}/accommodation`, { name: 'E2E cross-tenant room', price: 1, capacity: 1 }],
      ['POST', `muns/${vitMunId}/actions/submit-for-review`, undefined],
      ['POST', `organizer/muns/${vitMunId}/achievements`, { registrationId: crypto.randomUUID(), award: 'x' }],
    ]
    for (const [method, path, data] of writes) {
      const res = await api.fetch(path, { method, data })
      expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(403)
    }
    const deletes = [`committees/${vitCommitteeId}`, `products/${vitProductId}`]
    for (const path of deletes) {
      const res = await api.delete(path)
      expect(res.status(), `DELETE ${path}`).toBe(403)
    }

    // And nothing leaked through.
    const anon = await anonApi()
    const after = await getMun(anon, MUNS.published.slug)
    expect(after.committees.map((c) => c.name)).not.toContain('E2E cross-tenant committee')
    expect(after.registrationProducts.map((p) => p.name)).not.toContain('E2E cross-tenant pass')
    await anon.dispose()
  })
})
