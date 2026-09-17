import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_URL } from '../../env'
import { signInViaApi, type ApiSession } from '../../fixtures/api'
import { pageHeading } from '../../fixtures/ui'
import {
  createFreshOrganizer,
  main,
  submitApplicationViaApi,
  uid,
  type OwnedMun,
} from './_helpers'

/**
 * Organizer onboarding (Onboarding & Go-Live PRD, Gate 1): a brand-new host
 * creates an organizer account, completes the onboarding wizard (details in
 * onboarding.spec.ts), applies to host, and — once an admin approves — gets a
 * MUN to build out. The UI signup-to-application walk-through waits on the
 * wizard rebuild; the approval steps start from an API-created application.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const APPLY_FORM_MOVING = 'Apply form moves into the onboarding wizard (mun-hub-f1 rebuild); rewrite against the wizard'

let admin: ApiSession

test.beforeAll(async () => {
  // Once per file: the login rate limit is 5/min per email.
  admin = await signInViaApi('admin@munhub.test')
})

test.afterAll(async () => {
  await admin?.api.dispose()
})

async function decide(munId: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', notes?: string) {
  const res = await admin.api.post(`admin/muns/${munId}/review-application`, { data: { decision, notes } })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { id: string; status: string }
}

/** The signed-in browser's own workspace, read through the page's cookies. */
async function workspaceOf(page: Page): Promise<OwnedMun[]> {
  const res = await page.request.get(`${API_URL}/organizer/workspace/overview`)
  expect(res.status()).toBe(200)
  return ((await res.json()) as { muns: OwnedMun[] }).muns
}

function munCard(page: Page, name: string) {
  return main(page).getByRole('link', { name: new RegExp(name) })
}

test.describe('new organizer: sign up and apply through the UI', () => {
  // To cover once rebuilt: /organizer/signup -> welcome -> "Start your journey"
  // -> onboarding wizard (which now also submits the host application) -> an
  // empty-then-SUBMITTED workspace in Overview and My MUNs.
  test('signs up at /organizer/signup, onboards, and lands on an empty organizer workspace', () => {
    test.fixme(true, APPLY_FORM_MOVING)
  })

  test('submits the host application and sees it in their workspace', () => {
    test.fixme(true, APPLY_FORM_MOVING)
  })
})

test.describe.serial('new organizer: application approved', () => {
  const conferenceName = `E2E Journey MUN ${uid()}`
  let page: Page
  let api: APIRequestContext
  let munId = ''

  test.beforeAll(async ({ browser }) => {
    const organizer = await createFreshOrganizer('E2E Journey Organizer')
    api = organizer.api
    munId = (await submitApplicationViaApi(api, conferenceName)).munId
    page = await (await browser.newContext({ storageState: await api.storageState() })).newPage()
  })

  test.afterAll(async () => {
    await page?.context().close()
    await api?.dispose()
  })

  test('a submitted application shows in the organizer workspace', async () => {
    await page.goto('/organizer/dashboard')
    await expect(main(page).getByText(conferenceName)).toBeVisible()
    const mine = (await workspaceOf(page)).find((m) => m.id === munId)
    expect(mine?.status).toBe('SUBMITTED')
    await page.goto('/organizer/dashboard/muns')
    await expect(munCard(page, conferenceName)).toContainText('Submitted')
  })

  test('admin approval moves the new MUN into onboarding', async () => {
    expect(munId).not.toBe('')
    await decide(munId, 'APPROVED', 'Welcome aboard')

    await page.goto('/organizer/dashboard/muns')
    await expect(munCard(page, conferenceName)).toBeVisible()
    const mine = (await workspaceOf(page)).find((m) => m.id === munId)
    expect(mine?.status).toBe('ONBOARDING')
    await expect(munCard(page, conferenceName)).toContainText('Onboarding')
  })

  test('the approved MUN appears in My MUNs and its workspace opens', async () => {
    await page.goto('/organizer/dashboard/muns')
    const card = munCard(page, conferenceName)
    await expect(card).toHaveAttribute('href', `/organizer/dashboard/${munId}/setup`)
    await page.goto(`/organizer/dashboard/${munId}/setup`)
    await expect(page).toHaveURL(new RegExp(`/organizer/dashboard/${munId}/setup$`))
    await expect(pageHeading(page)).toHaveText('MUN Setup')
    await expect(main(page).getByLabel('Conference name')).toHaveValue(conferenceName)
  })
})

test.describe('application review outcomes reach the organizer', () => {
  async function organizerWithApplication(browser: import('@playwright/test').Browser) {
    const organizer = await createFreshOrganizer()
    const name = `E2E Review MUN ${uid()}`
    const application = await submitApplicationViaApi(organizer.api, name)
    const context = await browser.newContext({ storageState: await organizer.api.storageState() })
    return { organizer, name, munId: application.munId, context, page: await context.newPage() }
  }

  async function closeAll(api: APIRequestContext, page: Page) {
    await page.context().close()
    await api.dispose()
  }

  test('a request-changes decision is shown on the organizer\'s MUN', async ({ browser }) => {
    const { organizer, name, munId, page } = await organizerWithApplication(browser)
    const decided = await decide(munId, 'CHANGES_REQUESTED', 'Please add your past edition details.')
    expect(decided.status).toBe('CHANGES_REQUESTED')

    await page.goto('/organizer/dashboard/muns')
    await expect(munCard(page, name)).toContainText('Changes requested')
    await page.goto('/organizer/dashboard')
    await expect(main(page).getByRole('listitem').filter({ hasText: name })).toContainText('Changes requested')
    await closeAll(organizer.api, page)
  })

  test.fixme('the reviewer\'s change-request notes are shown to the organizer', async () => {
    // PRD Gate 1: the organizer must see what to fix. No organizer-facing
    // surface (UI or API) exposes the review notes today.
  })

  test('a rejected application is shown as rejected', async ({ browser }) => {
    const { organizer, name, munId, page } = await organizerWithApplication(browser)
    expect((await decide(munId, 'REJECTED', 'Not a fit')).status).toBe('REJECTED')
    await page.goto('/organizer/dashboard/muns')
    await expect(munCard(page, name)).toContainText(/rejected/i)
    await closeAll(organizer.api, page)
  })

  test('only reviewers can decide an application', async () => {
    const organizer = await createFreshOrganizer()
    const application = await submitApplicationViaApi(organizer.api, `E2E Self Approve ${uid()}`)
    const res = await organizer.api.post(`admin/muns/${application.munId}/review-application`, {
      data: { decision: 'APPROVED' },
    })
    expect(res.status()).toBe(403)
    await organizer.api.dispose()
  })
})

test.describe('host application form', () => {
  test('validates required fields before submitting', async ({ browser }) => {
    test.fixme(true, APPLY_FORM_MOVING)
    const organizer = await createFreshOrganizer()
    const context = await browser.newContext({ storageState: await organizer.api.storageState() })
    const page = await context.newPage()
    await page.goto('/organizer/apply')

    // Bypass native `required` so the page's own validation is exercised.
    await main(page).locator('form').evaluate((form) => form.setAttribute('novalidate', ''))
    await main(page).getByLabel('Tell us about your conference').fill('Too short')
    await main(page).getByLabel('Expected delegate count').fill('0')
    await main(page).getByLabel('Website (optional)').fill('not-a-url')
    await main(page).getByRole('button', { name: /submit application/i }).click()

    await expect(main(page)).toContainText('Enter the name of your conference.')
    await expect(main(page)).toContainText('Enter the host city.')
    await expect(main(page)).toContainText('Choose an expected start date.')
    await expect(main(page)).toContainText('Enter a whole number of delegates (1 or more).')
    await expect(main(page)).toContainText('at least 40 characters')
    await expect(main(page)).toContainText('Enter a full URL, including https://')
    await expect(page).toHaveURL(/\/organizer\/apply$/)
    await expect(main(page).getByLabel('Conference name')).toHaveAttribute('aria-invalid', 'true')

    // Nothing was created.
    const res = await page.request.get(`${API_URL}/organizer/workspace/overview`)
    expect(((await res.json()) as { muns: unknown[] }).muns).toHaveLength(0)
    await context.close()
    await organizer.api.dispose()
  })

  test('the API refuses an application with missing fields', async () => {
    const organizer = await createFreshOrganizer()
    const res = await organizer.api.post('organizer/applications', { data: { conferenceName: 'x' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    await organizer.api.dispose()
  })
})
