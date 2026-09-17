import { expect, request, test, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test'
import postgres from 'postgres'
import { API_ORIGIN, DATABASE_URL, WEB_URL, assertLocalDatabase } from '../../env'
import { STORAGE_STATE } from '../../paths'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import {
  completeOnboardingThroughUi,
  completeOnboardingViaApi,
  createFreshOrganizer,
  main,
  onboardingAnswers,
  onboardingStep,
  submitApplicationViaApi,
  uid,
  type OwnedMun,
} from './_helpers'

/**
 * Organizer onboarding wizard (publish.munhub.in/organizer/onboarding):
 * profile → your MUN → delegates & details → payout UPI → agreement.
 * Accepting the agreement submits the MUN answers as the organizer's host
 * application (lib/actions/organizer-onboarding.ts). Every test uses its own
 * fresh, not-yet-onboarded organizer.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const LOCKED = 'Your organizer details are already submitted. Contact support to change them.'
const OUT_OF_ORDER = 'Complete the earlier onboarding steps first'

interface Onboarding {
  completed: boolean
  nextStep: string | null
  completedSteps: string[]
  firstMunId: string | null
  profile: Record<string, unknown>
}

function apiFor(storageState: string | { cookies: []; origins: [] }) {
  return request.newContext({ baseURL: `${API_ORIGIN}/api/v1/`, extraHTTPHeaders: { Origin: WEB_URL }, storageState })
}

async function newOrganizer(browser: Browser, name = 'Riya Sharma') {
  const organizer = await createFreshOrganizer(name, { onboarded: false })
  const context = await browser.newContext({ storageState: await organizer.api.storageState() })
  const page = await context.newPage()
  return {
    ...organizer,
    page,
    async close() {
      await context.close()
      await organizer.api.dispose()
    },
  }
}

async function onboardingOf(api: APIRequestContext): Promise<Onboarding> {
  const res = await api.get('organizer/onboarding')
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Onboarding
}

async function workspaceMuns(api: APIRequestContext): Promise<OwnedMun[]> {
  const res = await api.get('organizer/workspace/overview')
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { muns: OwnedMun[] }).muns
}

async function expectError(res: APIResponse, status: number, message: string) {
  expect(res.status(), await res.text()).toBe(status)
  expect(((await res.json()) as { error: { message: string } }).error.message).toBe(message)
}

/** Deletes an organizer's onboarding row (local test database only). */
async function forgetOnboarding(userId: string): Promise<void> {
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    await sql`delete from organizer_profiles where user_id = ${userId}`
  } finally {
    await sql.end()
  }
}

function continueButton(page: Page) {
  return main(page).getByRole('button', { name: 'Continue' })
}

test.describe('onboarding wizard', () => {
  test('a new organizer walks every step, which submits their application for review', async ({ browser }) => {
    const org = await newOrganizer(browser)
    const { page } = org
    const crashes = watchForCrashes(page)
    const answers = onboardingAnswers(`E2E Wizard MUN ${uid()}`)

    // The welcome page points at the wizard until it's done.
    await page.goto('/organizer/welcome')
    await page.getByRole('link', { name: /start your journey/i }).click()
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)

    // Step 1 is current; later steps can't be jumped to yet.
    await expect(onboardingStep(page, 'Create profile')).toHaveAttribute('aria-current', 'step')
    for (const label of ['Your MUN', 'Delegates & details', 'Payment details', 'Agreement']) {
      await expect(onboardingStep(page, label)).toBeDisabled()
    }
    // The name given at signup is pre-filled.
    await expect(main(page).getByLabel('First name')).toHaveValue('Riya')
    await expect(main(page).getByLabel('Last name')).toHaveValue('Sharma')

    await completeOnboardingThroughUi(page, answers)
    await expect(page).toHaveURL(/\/organizer\/apply\/submitted$/)
    await expect(pageHeading(page)).toHaveText('Application submitted')
    await expect(main(page)).toContainText('2 business days')

    const state = await onboardingOf(org.api)
    expect(state).toMatchObject({ completed: true, nextStep: null })
    expect(state.completedSteps).toEqual(['PROFILE', 'MUN', 'DETAILS', 'PAYMENT', 'AGREEMENT'])
    expect(state.profile).toMatchObject({
      firstName: 'Riya',
      lastName: 'Sharma',
      contactPhone: answers.contactPhone,
      munName: answers.munName,
      munCity: answers.munCity,
      munStartDate: answers.munStartDate,
      expectedDelegateCount: answers.expectedDelegateCount,
      munDescription: answers.munDescription,
      previousEditions: answers.previousEditions,
      websiteUrl: answers.websiteUrl,
      upiId: answers.upiId,
      upiPhone: answers.upiPhone,
    })

    // The application exists, in the organizer's workspace and for the admin.
    const [mun] = await workspaceMuns(org.api)
    expect(mun).toMatchObject({ id: state.firstMunId, name: answers.munName, status: 'SUBMITTED' })
    const admin = await apiFor(STORAGE_STATE.admin)
    const review = await admin.get(`admin/muns/${mun.id}/review`)
    expect(review.status(), await review.text()).toBe(200)
    expect(await review.json()).toMatchObject({
      name: answers.munName,
      status: 'SUBMITTED',
      organizerApplication: { status: 'SUBMITTED' },
    })
    await admin.dispose()

    // Styled as a button but rendered as a link (Application submitted page, organizer shell).
    await main(page).getByRole('link', { name: /go to dashboard/i }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
    await expect(main(page).getByText(answers.munName)).toBeVisible()

    // Done: the wizard shows the finished state, and the welcome CTA moves on.
    await page.goto('/organizer/onboarding')
    await expect(pageHeading(page)).toHaveText("You're registered as an organizer")
    await main(page).getByRole('link', { name: 'Go to your dashboard' }).click()
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
    await page.goto('/organizer/welcome')
    await expect(main(page).getByRole('link', { name: 'Go to your dashboard' })).toBeVisible()
    await expect(main(page).getByRole('link', { name: /start your journey/i })).toHaveCount(0)

    crashes.assertNone()
    await org.close()
  })

  test('a completed step can be revisited from the stepper', async ({ browser }) => {
    const org = await newOrganizer(browser)
    const { page } = org
    const answers = onboardingAnswers()
    await page.goto('/organizer/onboarding')
    await main(page).getByLabel('Organizing body').fill(answers.organization)
    await main(page).getByLabel('Contact number').fill(answers.contactPhone)
    await continueButton(page).click()
    await expect(pageHeading(page)).toHaveText('Tell us about your MUN')
    await expect(onboardingStep(page, 'Your MUN')).toHaveAttribute('aria-current', 'step')

    await onboardingStep(page, 'Create profile').click()
    await expect(pageHeading(page)).toHaveText('Create your organizer profile')
    await expect(main(page).getByLabel('Contact number')).toHaveValue(answers.contactPhone)
    await main(page).getByLabel('Last name').fill('Verma')
    await continueButton(page).click()
    await expect(pageHeading(page)).toHaveText('Tell us about your MUN')
    expect((await onboardingOf(org.api)).profile.lastName).toBe('Verma')
    await org.close()
  })

  test('each step refuses invalid details', async ({ browser }) => {
    const org = await newOrganizer(browser)
    const { page } = org
    const form = main(page)
    const answers = onboardingAnswers()
    await page.goto('/organizer/onboarding')

    // Profile: a 10-digit number that isn't an Indian mobile number, and a blank name.
    await form.getByLabel('Contact number').fill('1234567890')
    await expect(form.getByRole('alert')).toHaveText('Enter a valid 10-digit mobile number.')
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('Contact number').fill(answers.contactPhone)
    // The organizing body is required too.
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('Organizing body').fill(answers.organization)
    await expect(continueButton(page)).toBeEnabled()
    await form.getByLabel('First name').fill('   ')
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('First name').fill('Riya')
    await continueButton(page).click()

    // Your MUN: every field is required.
    await expect(pageHeading(page)).toHaveText('Tell us about your MUN')
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('Title of your MUN').fill(answers.munName)
    await form.getByLabel('Host city').fill(answers.munCity)
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('Expected start date').fill(answers.munStartDate)
    await continueButton(page).click()

    // Delegates & details: a count, a 40-character description, and a full website URL.
    await expect(pageHeading(page)).toHaveText('Delegates & details')
    await form.getByLabel('Maximum delegates you expect').fill('abc')
    await expect(form.getByLabel('Maximum delegates you expect')).toHaveValue('')
    await form.getByLabel('Maximum delegates you expect').fill('0')
    await form.getByLabel('About your MUN').fill('Too short')
    await expect(form).toContainText('At least 40 characters (9 so far)')
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('Maximum delegates you expect').fill(String(answers.expectedDelegateCount))
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('About your MUN').fill(answers.munDescription)
    await expect(form).not.toContainText('so far)')
    await form.getByLabel('Website (optional)').fill('example.com/mun')
    await expect(form.getByRole('alert')).toHaveText('Enter the full website address, including https://')
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('Website (optional)').fill('')
    await continueButton(page).click()

    // Payment: the UPI ID must look like name@bank.
    await expect(pageHeading(page)).toHaveText('Payment details')
    await form.getByLabel('UPI ID', { exact: true }).fill('not@a-real@upi')
    await expect(form.getByRole('alert')).toHaveText('UPI IDs look like name@bank.')
    await form.getByLabel('Mobile number linked to this UPI ID').fill(answers.upiPhone)
    await expect(continueButton(page)).toBeDisabled()
    await form.getByLabel('UPI ID', { exact: true }).fill(answers.upiId)
    await continueButton(page).click()

    // Agreement: can't submit without ticking the box.
    await expect(pageHeading(page)).toHaveText('Organizer agreement')
    await expect(form.getByRole('button', { name: 'Submit application' })).toBeDisabled()

    const state = await onboardingOf(org.api)
    expect(state.nextStep).toBe('AGREEMENT')
    // The optional website was left blank.
    expect(state.profile.websiteUrl).toBeNull()
    expect(await workspaceMuns(org.api)).toHaveLength(0)
    await org.close()
  })

  test('the API validates every field', async () => {
    const { api } = await createFreshOrganizer('E2E Onboarding Validation', { onboarded: false })
    const answers = onboardingAnswers()
    const put = (step: string, data: Record<string, unknown>) => api.put(`organizer/onboarding/${step}`, { data })

    await expectError(
      await put('profile', { firstName: 'E2E', lastName: 'Org', contactPhone: '12345' }),
      400,
      'Contact number must be a 10-digit Indian mobile number',
    )
    await expectError(await put('profile', { firstName: ' ', lastName: 'Org', contactPhone: answers.contactPhone }), 400, 'First name is required')
    await expectError(
      await put('profile', { firstName: 'E2E', lastName: 'Org', contactPhone: answers.contactPhone, organization: '   ' }),
      400,
      'Organization is required',
    )
    await expectError(
      await put('profile', { firstName: 'E2E', lastName: 'Org', contactPhone: answers.contactPhone, organization: 'x'.repeat(121) }),
      400,
      'Organization must be at most 120 characters',
    )
    expect((await put('profile', { firstName: 'E2E', lastName: 'Org', contactPhone: '+91 98765 43210', organization: answers.organization })).status()).toBe(200)
    expect((await onboardingOf(api)).profile.contactPhone).toBe('9876543210')

    await expectError(await put('mun', { munName: ' ', munCity: 'Hyderabad', munStartDate: answers.munStartDate }), 400, 'MUN title is required')
    await expectError(await put('mun', { munName: 'E2E', munCity: '', munStartDate: answers.munStartDate }), 400, 'Host city is required')
    await expectError(
      await put('mun', { munName: 'E2E', munCity: 'Hyderabad', munStartDate: '17/09/2027' }),
      400,
      'Expected start date must be a valid date',
    )
    expect((await put('mun', { munName: answers.munName, munCity: answers.munCity, munStartDate: answers.munStartDate })).status()).toBe(200)

    const details = { expectedDelegateCount: 100, munDescription: answers.munDescription }
    for (const expectedDelegateCount of [0, 10_001, 2.5]) {
      await expectError(
        await put('details', { ...details, expectedDelegateCount }),
        400,
        'Maximum expected delegates must be a whole number from 1 to 10000',
      )
    }
    await expectError(
      await put('details', { ...details, munDescription: '   Too short, even when padded out.        ' }),
      400,
      'Description must be at least 40 characters',
    )
    for (const websiteUrl of ['example.com', 'ftp://example.com', 'javascript:alert(1)']) {
      await expectError(await put('details', { ...details, websiteUrl }), 400, 'Website must be a full URL, including https://')
    }
    expect((await put('details', details)).status()).toBe(200)

    await expectError(await put('payment', { upiId: 'no-at-sign', upiPhone: answers.upiPhone }), 400, 'UPI ID must look like name@bank')
    await expectError(
      await put('payment', { upiId: answers.upiId, upiPhone: '555' }),
      400,
      'UPI mobile number must be a 10-digit Indian mobile number',
    )
    expect((await put('payment', { upiId: answers.upiId, upiPhone: answers.upiPhone })).status()).toBe(200)

    await expectError(
      await api.post('organizer/onboarding/agreement', { data: { accepted: false } }),
      400,
      'You must accept the organizer agreement to continue',
    )
    // Unknown fields are refused outright.
    expect((await put('payment', { upiId: answers.upiId, upiPhone: answers.upiPhone, completedAt: new Date().toISOString() })).status()).toBe(400)
    expect((await api.post('organizer/onboarding/agreement', { data: { accepted: 'yes' } })).status()).toBe(400)

    const state = await onboardingOf(api)
    expect(state).toMatchObject({ completed: false, nextStep: 'AGREEMENT', firstMunId: null })
    expect(await workspaceMuns(api)).toHaveLength(0)
    await api.dispose()
  })

  test('steps must be completed in order', async () => {
    const { api } = await createFreshOrganizer('E2E Onboarding Order', { onboarded: false })
    const answers = onboardingAnswers()
    await expectError(
      await api.put('organizer/onboarding/mun', { data: { munName: answers.munName, munCity: answers.munCity, munStartDate: answers.munStartDate } }),
      409,
      OUT_OF_ORDER,
    )
    await expectError(await api.put('organizer/onboarding/payment', { data: { upiId: answers.upiId, upiPhone: answers.upiPhone } }), 409, OUT_OF_ORDER)
    await expectError(await api.post('organizer/onboarding/agreement', { data: { accepted: true } }), 409, OUT_OF_ORDER)
    expect((await onboardingOf(api)).completedSteps).toEqual([])
    expect(await workspaceMuns(api)).toHaveLength(0)
    await api.dispose()
  })
})

test.describe('onboarding gates the host application', () => {
  test('an organizer who has not onboarded is sent to the wizard and refused by the API', async ({ browser }) => {
    const org = await newOrganizer(browser)
    const { page } = org

    await page.goto('/organizer/apply')
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)
    await expect(pageHeading(page)).toHaveText('Create your organizer profile')

    const res = await org.api.post('organizer/applications', {
      data: {
        conferenceName: `E2E Not Onboarded ${uid()}`,
        location: 'Hyderabad',
        expectedDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
        expectedDelegateCount: 100,
        description: 'An end-to-end test conference that should never be created.',
      },
    })
    await expectError(res, 409, 'Finish organizer onboarding before applying to host a MUN')
    expect(await workspaceMuns(org.api)).toHaveLength(0)

    // Once onboarded (which submits the application), /organizer/apply stays put
    // and says that application is under review (multi-MUN hosting, 57943d3).
    const answers = onboardingAnswers()
    await completeOnboardingViaApi(org.api, answers)
    expect(await workspaceMuns(org.api)).toHaveLength(1)
    await page.goto('/organizer/apply')
    await expect(page).toHaveURL(/\/organizer\/apply$/)
    await expect(pageHeading(page)).toHaveText(`${answers.munName} is being reviewed`)
    await page.goto('/organizer/onboarding')
    await expect(pageHeading(page)).toHaveText("You're registered as an organizer")
    await org.close()
  })

  test('an organizer who applied before onboarding existed gets no second application from the wizard, and cannot stack a second while the first is reviewed', async () => {
    // Apply through the API (the fixture marks onboarding done), then drop the
    // onboarding row: the state of an organizer who applied before the wizard existed.
    const { api, userId } = await createFreshOrganizer('E2E Applied First')
    const applied = await submitApplicationViaApi(api, `E2E Applied First ${uid()}`)
    await expectError(
      await api.post('organizer/applications', {
        data: {
          conferenceName: `E2E Second Application ${uid()}`,
          location: 'Hyderabad',
          expectedDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
          expectedDelegateCount: 100,
          description: 'An end-to-end test conference that should never be created.',
        },
      }),
      409,
      'Your previous application is still being reviewed. You can apply for another MUN once it has been reviewed.',
    )
    await forgetOnboarding(userId)
    expect((await onboardingOf(api)).completed).toBe(false)

    await completeOnboardingViaApi(api, onboardingAnswers(`E2E Wizard Duplicate ${uid()}`))
    expect((await workspaceMuns(api)).map((m) => m.id)).toEqual([applied.munId])
    expect((await onboardingOf(api))).toMatchObject({ completed: true, firstMunId: applied.munId })
    await api.dispose()
  })
})

test.describe('onboarding is locked once submitted', () => {
  test('no step can be changed after the agreement is accepted', async ({ browser }) => {
    const org = await newOrganizer(browser)
    const answers = onboardingAnswers()
    await completeOnboardingViaApi(org.api, answers)
    const before = await onboardingOf(org.api)
    expect(before.completed).toBe(true)

    for (const [path, method, data] of [
      ['profile', 'put', { firstName: 'Changed', lastName: 'Name', contactPhone: '9000000000' }],
      ['mun', 'put', { munName: 'Renamed MUN', munCity: 'Delhi', munStartDate: answers.munStartDate }],
      ['details', 'put', { expectedDelegateCount: 5, munDescription: answers.munDescription }],
      ['payment', 'put', { upiId: 'attacker@okaxis', upiPhone: '9000000000' }],
      ['agreement', 'post', { accepted: true }],
    ] as const) {
      await expectError(await org.api[method](`organizer/onboarding/${path}`, { data }), 409, LOCKED)
    }
    expect(await onboardingOf(org.api)).toEqual(before)
    // Re-accepting didn't create another application.
    expect(await workspaceMuns(org.api)).toHaveLength(1)

    await org.page.goto('/organizer/onboarding')
    await expect(pageHeading(org.page)).toHaveText("You're registered as an organizer")
    await expect(main(org.page).getByRole('textbox')).toHaveCount(0)
    await org.close()
  })
})

test.describe('onboarding is for organizer accounts only', () => {
  test('a delegate is refused by the page and the API', async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE.student })
    const page = await context.newPage()
    await page.goto('/organizer/onboarding')
    await expect(pageHeading(page)).toHaveText('Access denied')
    await expect(main(page)).toContainText(/isn't an organizer account/)
    await expect(main(page).getByRole('textbox')).toHaveCount(0)

    const api = await apiFor(STORAGE_STATE.student)
    expect((await api.get('organizer/onboarding')).status()).toBe(403)
    expect(
      (await api.put('organizer/onboarding/profile', { data: { firstName: 'A', lastName: 'B', contactPhone: '9876543210' } })).status(),
    ).toBe(403)
    expect((await api.post('organizer/onboarding/agreement', { data: { accepted: true } })).status()).toBe(403)
    await api.dispose()
    await context.close()
  })

  test('a signed-out visitor is refused by the API', async () => {
    const api = await apiFor({ cookies: [], origins: [] })
    expect((await api.get('organizer/onboarding')).status()).toBe(401)
    expect((await api.post('organizer/onboarding/agreement', { data: { accepted: true } })).status()).toBe(401)
    await api.dispose()
  })
})
