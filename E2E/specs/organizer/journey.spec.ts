import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_URL } from '../../env'
import { signInViaApi, type ApiSession } from '../../fixtures/api'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import {
  completeOnboardingThroughUi,
  createFreshOrganizer,
  main,
  onboardingAnswers,
  signUpOrganizerThroughUi,
  submitApplicationViaApi,
  uid,
  type OwnedMun,
} from './_helpers'

/**
 * Organizer onboarding (Onboarding & Go-Live PRD, Gate 1): a brand-new host
 * creates an organizer account, completes the onboarding wizard (details in
 * onboarding.spec.ts), and — once an admin approves — gets a
 * MUN to build out. The wizard is the application: its last step submits it.
 */

test.use({ storageState: { cookies: [], origins: [] } })

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

test.describe.serial('new organizer: sign up, onboard (which applies), get approved', () => {
  const conferenceName = `E2E Journey MUN ${uid()}`
  let page: Page
  let munId = ''

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
  })

  test.afterAll(async () => {
    await page?.context().close()
  })

  test('signs up at /organizer/signup and lands on an empty organizer workspace', async () => {
    const crashes = watchForCrashes(page)
    await signUpOrganizerThroughUi(page)

    // A new organizer lands on the welcome page (covered in detail by specs/auth).
    await expect(page).toHaveURL(/\/organizer\/welcome$/)

    await page.goto('/organizer/dashboard')
    await expect(pageHeading(page)).toHaveText('Overview')
    await expect(page.getByRole('button', { name: /account menu \(organizer\)/i })).toBeVisible()
    await expect(main(page).getByRole('heading', { name: 'No conferences yet' })).toBeVisible()
    await page.goto('/organizer/dashboard/muns')
    await expect(pageHeading(page)).toHaveText('My MUNs')
    await expect(main(page).getByRole('heading', { name: 'No conferences yet' })).toBeVisible()
    // The host application is the onboarding wizard. Two "Host a MUN" buttons
    // render (page header + empty state); either leads to the same place.
    await main(page).getByRole('button', { name: 'Host a MUN' }).first().click()
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)
    await expect(pageHeading(page)).toHaveText('Create your organizer profile')
    crashes.assertNone()
  })

  test('completes onboarding, which submits the application, and sees it in the workspace', async () => {
    await page.goto('/organizer/welcome')
    await page.getByRole('link', { name: /start your journey/i }).click()
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)
    await completeOnboardingThroughUi(page, onboardingAnswers(conferenceName))

    await expect(page).toHaveURL(/\/organizer\/apply\/submitted$/)
    await expect(pageHeading(page)).toHaveText('Application submitted')
    // Styled as a button but rendered as a link (Application submitted page, organizer shell).
    await main(page).getByRole('link', { name: /go to dashboard/i }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
    await expect(main(page).getByText(conferenceName)).toBeVisible()

    const mine = (await workspaceOf(page)).find((m) => m.name === conferenceName)
    expect(mine?.status).toBe('SUBMITTED')
    munId = mine!.id

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

test.describe('host application API', () => {
  test('the API refuses an application with missing fields', async () => {
    const organizer = await createFreshOrganizer()
    const res = await organizer.api.post('organizer/applications', { data: { conferenceName: 'x' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    await organizer.api.dispose()
  })
})
