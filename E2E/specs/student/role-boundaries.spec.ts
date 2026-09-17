import { expect, test, type Page } from '@playwright/test'
import { getMun, newApiContext, signUpViaApi } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { main } from './_helpers'

/**
 * A delegate account never reaches organizer or admin tools — in the UI or
 * through the API. Uses the seeded student session (read-only checks).
 */

/** Collects privileged API responses that came back successfully while the page was open. */
function watchPrivilegedApi(page: Page) {
  const leaked: string[] = []
  page.on('response', (res) => {
    const url = new URL(res.url())
    if (/\/api\/v1\/(admin|organizer)\//.test(url.pathname) && res.ok()) leaked.push(`${res.status()} ${url.pathname}`)
  })
  return { assertNone: () => expect(leaked, 'privileged API calls that succeeded').toEqual([]) }
}

async function expectAccessDenied(page: Page, path: string, reason: RegExp) {
  const crashes = watchForCrashes(page)
  const privileged = watchPrivilegedApi(page)
  await page.goto(path)
  await expect(pageHeading(page)).toHaveText('Access denied')
  await expect(main(page)).toContainText('403')
  await expect(main(page)).toContainText(reason)
  // Nothing from the gated area renders behind the refusal.
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
  await expect(main(page).getByRole('heading', { name: /overview|review queue|your conferences/i })).toHaveCount(0)
  await expect(main(page)).not.toContainText(/registrations|delegates|payments/i)
  await main(page).getByRole('button', { name: 'Back to home' }).click()
  await expect(page).toHaveURL(/\/$/)
  privileged.assertNone()
  crashes.assertNone()
}

test.describe('role boundaries — pages', () => {
  const ORGANIZER_REASON = /isn't an organizer account/
  const ADMIN_REASON = /doesn't have permission/

  test('the organizer workspace refuses a delegate', async ({ page }) => {
    await expectAccessDenied(page, '/organizer/dashboard', ORGANIZER_REASON)
  })

  test('organizer workspace sub-pages refuse a delegate', async ({ page }) => {
    await expectAccessDenied(page, '/organizer/dashboard/muns', ORGANIZER_REASON)
    const api = await newApiContext()
    const mun = await getMun(api, OPEN.slug)
    await api.dispose()
    // Unknown workspace ids bounce to /organizer/dashboard/muns — still refused.
    await expectAccessDenied(page, `/organizer/dashboard/${mun.id}/registrations`, ORGANIZER_REASON)
  })

  test('the host application form refuses a delegate', async ({ page }) => {
    await expectAccessDenied(page, '/organizer/apply', ORGANIZER_REASON)
    await expect(page.getByRole('textbox', { name: /conference name/i })).toHaveCount(0)
  })

  test('the organizer support inbox refuses a delegate', async ({ page }) => {
    await expectAccessDenied(page, '/organizer/support', ORGANIZER_REASON)
  })

  test('the admin console refuses a delegate', async ({ page }) => {
    await expectAccessDenied(page, '/admin', ADMIN_REASON)
  })

  for (const path of ['/admin/review', '/admin/registrations', '/admin/payments', '/admin/support', '/admin/audit']) {
    test(`${path} refuses a delegate`, async ({ page }) => {
      await expectAccessDenied(page, path, ADMIN_REASON)
    })
  }
})

test.describe('role boundaries — no organizer entry points for delegates', () => {
  test('home page, header and footer offer no "List your MUN" link', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /account menu \(delegate\)/i })).toBeVisible()
    await expect(page.getByRole('contentinfo').getByRole('navigation', { name: 'For organizers' })).toBeVisible()

    for (const region of [page.getByRole('banner'), page.getByRole('main'), page.getByRole('contentinfo')]) {
      await expect(region.getByRole('link', { name: /list your mun/i })).toHaveCount(0)
      await expect(region.getByRole('button', { name: /list your mun/i })).toHaveCount(0)
    }
    await expect(page.locator('a[href*="/organizer/apply"], a[href*="/organizer/signup"]')).toHaveCount(0)
  })

  test('about and contact pages offer no organizer registration link', async ({ page }) => {
    for (const path of ['/about', '/contact']) {
      await page.goto(path)
      await expect(pageHeading(page)).toBeVisible()
      await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible()
      await expect(page.locator('a[href*="/organizer/apply"], a[href*="/organizer/signup"]')).toHaveCount(0)
    }
  })

  test('the account menu has no organizer or admin destinations', async ({ page }) => {
    await page.goto('/muns')
    await page.getByRole('button', { name: /account menu/i }).click()
    const items = page.getByRole('menu').getByRole('menuitem')
    await expect(items).toHaveText(['Dashboard', 'My registrations', 'Profile & account', 'Support', 'Sign out'])
    for (const href of await items.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))) {
      expect(href).not.toMatch(/organizer|admin/)
    }
  })
})

test.describe('role boundaries — API', () => {
  test('admin endpoints refuse a delegate with 403', async () => {
    const student = await signUpViaApi()
    for (const path of [
      'admin/overview',
      'admin/registrations',
      'admin/audit',
      'admin/review-queue',
      'admin/support/tickets',
      'admin/support/unread-count',
    ]) {
      const res = await student.api.get(path)
      expect(res.status(), path).toBe(403)
    }
    // A random id: the role check must refuse before any lookup, so no real
    // MUN is put at risk even if it didn't.
    const unpublish = await student.api.post(`admin/muns/${crypto.randomUUID()}/unpublish`)
    expect(unpublish.status()).toBe(403)
  })

  test.describe('signed out', () => {
    // newApiContext() inherits the project's storageState, so clear it here.
    test.use({ storageState: { cookies: [], origins: [] } })

    test('the same endpoints refuse a signed-out caller with 401', async () => {
      const anon = await newApiContext()
      for (const path of ['admin/overview', 'organizer/workspace/overview', 'me/registrations/upcoming']) {
        expect((await anon.get(path)).status(), path).toBe(401)
      }
      await anon.dispose()
    })
  })

  test('organizer-only endpoints refuse a delegate', async () => {
    const student = await signUpViaApi()
    const mun = await getMun(student.api, OPEN.slug)

    const delegates = await student.api.get(`organizer/muns/${mun.id}/delegates`)
    expect(delegates.status()).toBe(403)
    const overview = await student.api.get(`organizer/muns/${mun.id}/overview`)
    expect(overview.status()).toBe(403)
    const details = await student.api.get(`organizer/muns/${mun.id}/details`)
    expect(details.status()).toBe(403)

    const apply = await student.api.post('organizer/applications', {
      data: {
        conferenceName: 'E2E Delegate Should Not Host',
        location: 'Hyderabad',
        expectedDate: '2027-01-15',
        expectedDelegateCount: 100,
        description: 'A delegate account must never be able to submit a host application.',
      },
    })
    expect(apply.status()).toBe(403)

    const addCommittee = await student.api.post(`muns/${mun.id}/committees`, {
      data: { name: 'E2E Hijacked Committee', capacity: 10 },
    })
    expect(addCommittee.status()).toBe(403)
    expect((await getMun(student.api, OPEN.slug)).committees.map((c) => c.name)).not.toContain('E2E Hijacked Committee')
  })

  test('the organizer workspace overview leaks nothing to a delegate', async () => {
    // This endpoint answers any signed-in user with *their own* MUNs, so a
    // delegate gets an empty workspace rather than a 403.
    const student = await signUpViaApi()
    const res = await student.api.get('organizer/workspace/overview')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.muns).toEqual([])
    expect(body.totals.registrations).toBe(0)
    expect(JSON.stringify(body)).not.toContain(OPEN.name)
  })
})
