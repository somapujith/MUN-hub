import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { signUpViaApi } from '../../fixtures/api'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { STORAGE_STATE } from '../../paths'
import { anonApi, createFreshOrganizer, main, onboardingAnswers, submitApplicationViaApi, uid } from './_helpers'

/**
 * Organizers can host more than one MUN (57943d3). /organizer/apply is the
 * "Host another MUN" form for an onboarded organizer, blocked only while one
 * of their applications is still awaiting review. Every test uses its own
 * fresh organizer.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const STILL_REVIEWING =
  'Your previous application is still being reviewed. You can apply for another MUN once it has been reviewed.'

interface ApplicationRow {
  id: string
  munId: string
  munName: string
  munSlug: string
  munStatus: string
  status: string
  reviewNotes: string | null
  submittedAt: string
}

async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.admin,
  })
}

async function decide(munId: string, decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED', notes?: string) {
  const admin = await adminApi()
  const res = await admin.post(`admin/muns/${munId}/review-application`, {
    data: { decision, ...(notes ? { notes } : {}) },
  })
  expect(res.status(), await res.text()).toBeLessThan(300)
  await admin.dispose()
}

async function applicationsOf(api: APIRequestContext): Promise<ApplicationRow[]> {
  const res = await api.get('organizer/applications')
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as ApplicationRow[]
}

async function organizerPage(browser: Browser, api: APIRequestContext): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: await api.storageState() })
  const page = await context.newPage()
  return { page, close: () => context.close() }
}

function applicationsPanel(page: Page) {
  return page.getByRole('complementary', { name: 'Your applications' })
}

function applicationCard(page: Page, munName: string) {
  return applicationsPanel(page).getByRole('listitem').filter({ hasText: munName })
}

test.describe('host another MUN — API', () => {
  test('a second application waits until the first one is reviewed, then goes through', async () => {
    const organizer = await createFreshOrganizer('E2E Multi Host')
    const first = `E2E Multi First ${uid()}`
    const second = `E2E Multi Second ${uid()}`

    const a = await submitApplicationViaApi(organizer.api, first)
    const blocked = await organizer.api.post('organizer/applications', {
      data: {
        conferenceName: second,
        location: 'Hyderabad',
        expectedDate: new Date(Date.now() + 150 * 86_400_000).toISOString(),
        expectedDelegateCount: 90,
        description: 'A second conference that must wait for the first review.',
      },
    })
    expect(blocked.status()).toBe(409)
    expect((await blocked.json()).error.message).toBe(STILL_REVIEWING)

    await decide(a.munId, 'APPROVED')
    const b = await submitApplicationViaApi(organizer.api, second)
    expect(b.munId).not.toBe(a.munId)

    const rows = await applicationsOf(organizer.api)
    expect(rows.map((r) => r.munName)).toEqual([second, first])
    expect(rows[0]).toMatchObject({ munId: b.munId, status: 'SUBMITTED' })
    expect(rows[1]).toMatchObject({ munId: a.munId, status: 'APPROVED', munStatus: 'ONBOARDING' })
    expect(rows[0].munSlug).toBeTruthy()

    // Both MUNs belong to this organizer, and no one else's show up.
    const overview = await organizer.api.get('organizer/workspace/overview')
    const ids = ((await overview.json()) as { muns: Array<{ id: string }> }).muns.map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining([a.munId, b.munId]))
    await organizer.api.dispose()
  })

  test('a rejected or changes-requested application does not block a new one', async () => {
    for (const decision of ['REJECTED', 'CHANGES_REQUESTED'] as const) {
      const organizer = await createFreshOrganizer()
      const a = await submitApplicationViaApi(organizer.api, `E2E Multi ${decision} ${uid()}`)
      await decide(a.munId, decision, 'The venue details are missing.')
      await submitApplicationViaApi(organizer.api, `E2E Multi After ${decision} ${uid()}`)
      const rows = await applicationsOf(organizer.api)
      expect(rows[1]).toMatchObject({ status: decision, reviewNotes: 'The venue details are missing.' })
      await organizer.api.dispose()
    }
  })

  test('the applications list is for organizers only and shows only their own', async () => {
    const mine = await createFreshOrganizer()
    const theirs = await createFreshOrganizer()
    const theirName = `E2E Multi Theirs ${uid()}`
    await submitApplicationViaApi(theirs.api, theirName)
    expect((await applicationsOf(mine.api)).map((r) => r.munName)).not.toContain(theirName)

    const delegate = await signUpViaApi()
    expect((await delegate.api.get('organizer/applications')).status()).toBe(403)
    const anon = await anonApi()
    expect((await anon.get('organizer/applications')).status()).toBe(401)
    await anon.dispose()
    await mine.api.dispose()
    await theirs.api.dispose()
  })

  test('an organizer who has not finished onboarding still cannot apply', async () => {
    const organizer = await createFreshOrganizer('E2E Not Onboarded', { onboarded: false })
    const res = await organizer.api.post('organizer/applications', {
      data: {
        conferenceName: `E2E Multi Early ${uid()}`,
        location: 'Hyderabad',
        expectedDate: new Date(Date.now() + 150 * 86_400_000).toISOString(),
        expectedDelegateCount: 90,
        description: 'Should be refused until onboarding is complete.',
      },
    })
    expect(res.status()).toBe(409)
    await organizer.api.dispose()
  })
})

test.describe('host another MUN — UI', () => {
  test('a not-yet-onboarded organizer is sent to the onboarding wizard', async ({ browser }) => {
    const organizer = await createFreshOrganizer('E2E Not Onboarded', { onboarded: false })
    const { page, close } = await organizerPage(browser, organizer.api)
    await page.goto('/organizer/apply')
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)
    await close()
  })

  test('while an application is under review, the page says so instead of showing the form', async ({ browser }) => {
    const organizer = await createFreshOrganizer()
    const name = `E2E Multi Pending ${uid()}`
    await submitApplicationViaApi(organizer.api, name)
    const { page, close } = await organizerPage(browser, organizer.api)
    const crashes = watchForCrashes(page)

    await page.goto('/organizer/apply')
    await expect(pageHeading(page)).toHaveText(`${name} is being reviewed`)
    await expect(main(page).getByLabel('Title of your MUN')).toHaveCount(0)
    await expect(applicationCard(page, name)).toContainText('Under review')
    await page.getByRole('link', { name: 'Go to your dashboard' }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard/)
    crashes.assertNone()
    await close()
  })

  test('an approved organizer hosts another MUN through the form', async ({ browser }) => {
    const organizer = await createFreshOrganizer()
    const first = `E2E Multi Approved ${uid()}`
    const a = await submitApplicationViaApi(organizer.api, first)
    await decide(a.munId, 'APPROVED')
    const { page, close } = await organizerPage(browser, organizer.api)
    const crashes = watchForCrashes(page)

    await page.goto('/organizer/apply')
    await expect(pageHeading(page)).toHaveText('Host another MUN')
    const approved = applicationCard(page, first)
    await expect(approved).toContainText('Approved')
    await expect(approved.getByRole('link', { name: 'Open in dashboard' })).toBeVisible()

    const answers = onboardingAnswers(`E2E Multi Second UI ${uid()}`)
    const form = main(page)
    const submit = form.getByRole('button', { name: 'Submit application' })
    await form.getByLabel('Title of your MUN').fill(answers.munName)
    await form.getByLabel('Host city').fill(answers.munCity)
    await form.getByLabel('Expected start date').fill(answers.munStartDate)
    await form.getByLabel('Maximum delegates you expect').fill(String(answers.expectedDelegateCount))

    // The description needs 40+ characters before the form can be sent.
    await form.getByLabel('About your MUN').fill('Too short')
    await expect(form.getByText(/At least 40 characters \(9 so far\)/)).toBeVisible()
    await expect(submit).toBeDisabled()
    await form.getByLabel('About your MUN').fill(answers.munDescription)
    await form.getByLabel('Previous editions (optional)').fill(answers.previousEditions)
    await form.getByLabel('Website (optional)').fill(answers.websiteUrl)
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page).toHaveURL(/\/organizer\/apply\/submitted$/)
    const rows = await applicationsOf(organizer.api)
    expect(rows[0]).toMatchObject({ munName: answers.munName, status: 'SUBMITTED' })
    expect(rows).toHaveLength(2)

    // Back on the page, the new application now blocks a third.
    await page.goto('/organizer/apply')
    await expect(pageHeading(page)).toHaveText(`${answers.munName} is being reviewed`)
    crashes.assertNone()
    await close()
  })

  test('review outcomes show on the application cards', async ({ browser }) => {
    const organizer = await createFreshOrganizer()
    const changes = `E2E Multi Changes ${uid()}`
    const rejected = `E2E Multi Rejected ${uid()}`
    const note = `Please add the venue address ${uid()}`

    const a = await submitApplicationViaApi(organizer.api, changes)
    await decide(a.munId, 'CHANGES_REQUESTED', note)
    const b = await submitApplicationViaApi(organizer.api, rejected)
    await decide(b.munId, 'REJECTED', 'Not a fit for the platform right now.')

    const { page, close } = await organizerPage(browser, organizer.api)
    await page.goto('/organizer/apply')
    await expect(pageHeading(page)).toHaveText('Host another MUN')

    const changesCard = applicationCard(page, changes)
    await expect(changesCard).toContainText('Changes requested')
    await expect(changesCard).toContainText(`Note from MUN Hub: ${note}`)
    await expect(changesCard.getByRole('link', { name: 'Update your MUN' })).toBeVisible()

    const rejectedCard = applicationCard(page, rejected)
    await expect(rejectedCard).toContainText('Not approved')
    await expect(rejectedCard.getByRole('link')).toHaveCount(0)
    await close()
  })

  test('the finished onboarding page links to hosting another MUN', async ({ browser }) => {
    const organizer = await createFreshOrganizer()
    const { page, close } = await organizerPage(browser, organizer.api)
    await page.goto('/organizer/onboarding')
    await expect(pageHeading(page)).toHaveText("You're registered as an organizer")
    await main(page).getByRole('link', { name: 'Host another MUN' }).click()
    await expect(page).toHaveURL(/\/organizer\/apply$/)
    await expect(pageHeading(page)).toHaveText('Host another MUN')
    await close()
  })

  test('a delegate cannot open the form', async ({ browser }) => {
    const delegate = await signUpViaApi()
    const { page, close } = await organizerPage(browser, delegate.api)
    await page.goto('/organizer/apply')
    await expect(pageHeading(page)).toHaveText('Access denied')
    await expect(main(page).getByLabel('Title of your MUN')).toHaveCount(0)
    await close()
  })
})
