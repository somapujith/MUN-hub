import { expect, request, type APIRequestContext, type Page } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { TEST_LOGIN_CODE, seedOrganizerLoginCode, signUpOrganizerViaApi } from '../../fixtures/api'
import { STORAGE_STATE } from '../../paths'
import { SANDBOX } from '../../fixtures/fixture-muns'
import { uniqueEmail } from '../../fixtures/data'

/** Shared helpers for the organizer workspace specs. */

export interface OwnedMun {
  id: string
  name: string
  slug: string
  edition: string | null
  status: string
  registrationCount: number
  confirmedCount: number
  capacity: number
}

/** An API context signed in as the seeded organizer, reusing the saved session (no extra login). */
export async function organizerApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.organizer,
  })
}

export async function ownedMuns(api: APIRequestContext): Promise<OwnedMun[]> {
  const res = await api.get('organizer/workspace/overview')
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { muns: OwnedMun[] }).muns
}

export async function ownedMunBySlug(api: APIRequestContext, slug: string): Promise<OwnedMun> {
  const mun = (await ownedMuns(api)).find((m) => m.slug === slug)
  if (!mun) throw new Error(`organizer does not own a MUN with slug ${slug}`)
  return mun
}

/** The sandbox is ONBOARDING, so it isn't publicly readable — resolve its id through the owner's workspace. */
export async function sandboxId(api: APIRequestContext): Promise<string> {
  return (await ownedMunBySlug(api, SANDBOX.slug)).id
}

export function sectionPath(munId: string, segment: string): string {
  return `/organizer/dashboard/${munId}/${segment}`
}

/** Opens a per-MUN workspace section and asserts it actually rendered there (not redirected away). */
export async function openSection(page: Page, munId: string, segment: string, heading: string | RegExp): Promise<void> {
  await page.goto(sectionPath(munId, segment))
  await expect(page).toHaveURL(new RegExp(`${sectionPath(munId, segment)}$`), { timeout: 5_000 })
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}

export function main(page: Page) {
  return page.getByRole('main')
}

/** The card for one list item (identified by its h2) inside a labelled list region. */
export function cardFor(page: Page, regionName: string, itemName: string) {
  return main(page)
    .getByRole('region', { name: regionName, exact: true })
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: itemName, exact: true }) })
    .first()
}

/** Accepts the next window.confirm() the page raises. */
export function acceptNextConfirm(page: Page): void {
  page.once('dialog', (dialog) => void dialog.accept())
}

/**
 * A signed-OUT API context. Explicitly empty storageState: inside this
 * project a bare `request.newContext()` would inherit the organizer's session.
 */
export async function anonApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: { cookies: [], origins: [] },
  })
}

/*
 * ORGANIZER ACCOUNT CREATION — the only two places specs create organizer
 * accounts (API and UI). Keep it that way so a change to the signup flow
 * (e.g. passwordless sign-in) is a two-function edit.
 */

/**
 * Signs a brand-new organizer up through the /organizer/signup page
 * (details -> emailed code -> verify). Leaves the page signed in, wherever
 * signup lands it. Returns the email used.
 */
export async function signUpOrganizerThroughUi(page: Page, name = 'E2E Journey Organizer'): Promise<string> {
  const email = uniqueEmail('journey-org')
  await page.goto('/organizer/signup')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/create your organizer account/i)
  const form = main(page)
  await form.getByLabel('Full name').fill(name)
  await form.getByLabel('Email address').fill(email)
  await form.getByLabel('Phone (optional)').fill('9876512345')
  await form.getByRole('checkbox', { name: /terms of service/i }).click()
  await form.getByRole('checkbox', { name: /privacy policy/i }).click()
  await form.getByRole('button', { name: /^send otp$/i }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter OTP')
  await expect(main(page)).toContainText(email.toLowerCase())
  // After "Send OTP": requesting a code consumes any older one.
  await seedOrganizerLoginCode(email)
  await expect(form.getByRole('button', { name: 'Verify and create account' })).toBeDisabled()
  // Entering the sixth digit submits the form by itself.
  await form.getByLabel('6-digit code').fill(TEST_LOGIN_CODE)
  return email
}

/** Creates a brand-new ORGANIZER through the real passwordless signup and returns a signed-in API context. */
export async function createFreshOrganizer(name = 'E2E Organizer', { onboarded = true }: { onboarded?: boolean } = {}) {
  const session = await signUpOrganizerViaApi(name, undefined, { onboarded })
  expect(session.role).toBe('ORGANIZER')
  return { api: session.api, email: session.email, userId: session.userId }
}

/** Valid answers for the organizer onboarding wizard (lib/actions/organizer-onboarding.ts). */
export function onboardingAnswers(conferenceName = `E2E Wizard MUN ${uid()}`) {
  return {
    contactPhone: '9876543210',
    organization: 'E2E Debating Society',
    munName: conferenceName,
    munCity: 'Hyderabad',
    // YYYY-MM-DD, ~4 months out.
    munStartDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    expectedDelegateCount: 180,
    munDescription: 'Three committees, a crisis cabinet, and a press corps. Our first edition on MUN Hub.',
    previousEditions: '2nd edition, 120 delegates last year',
    websiteUrl: 'https://example.com/e2e-wizard',
    upiId: 'e2e.organizer@okhdfcbank',
    upiPhone: '9123456780',
  }
}

export type OnboardingAnswers = ReturnType<typeof onboardingAnswers>

/** A button in the onboarding wizard's stepper ("01 Create profile" … "05 Agreement"). */
export function onboardingStep(page: Page, label: string) {
  return page.getByRole('navigation', { name: 'Onboarding steps' }).getByRole('button', { name: new RegExp(label) })
}

/**
 * Walks the onboarding wizard at /organizer/onboarding from its current step
 * (the profile step) through the agreement. Submitting also submits the host
 * application; the page ends on /organizer/apply/submitted.
 */
export async function completeOnboardingThroughUi(page: Page, answers: OnboardingAnswers = onboardingAnswers()) {
  const form = main(page)
  const heading = page.getByRole('heading', { level: 1 })
  const next = form.getByRole('button', { name: 'Continue' })

  await expect(heading).toHaveText('Create your organizer profile')
  await form.getByLabel('Organizing body').fill(answers.organization)
  await form.getByLabel('Contact number').fill(answers.contactPhone)
  await next.click()

  await expect(heading).toHaveText('Tell us about your MUN')
  await form.getByLabel('Title of your MUN').fill(answers.munName)
  await form.getByLabel('Host city').fill(answers.munCity)
  await form.getByLabel('Expected start date').fill(answers.munStartDate)
  await next.click()

  await expect(heading).toHaveText('Delegates & details')
  await form.getByLabel('Maximum delegates you expect').fill(String(answers.expectedDelegateCount))
  await form.getByLabel('About your MUN').fill(answers.munDescription)
  await form.getByLabel('Previous editions (optional)').fill(answers.previousEditions)
  await form.getByLabel('Website (optional)').fill(answers.websiteUrl)
  await next.click()

  await expect(heading).toHaveText('Payment details')
  await form.getByLabel('UPI ID', { exact: true }).fill(answers.upiId)
  await form.getByLabel('Mobile number linked to this UPI ID').fill(answers.upiPhone)
  await next.click()

  await expect(heading).toHaveText('Organizer agreement')
  await form.getByRole('checkbox', { name: /^I have read and agree to the MUN Hub organizer agreement/ }).check()
  await form.getByRole('button', { name: 'Submit application' }).click()
}

/** Completes every onboarding step through the API, in order (the last one submits the application). */
export async function completeOnboardingViaApi(
  api: APIRequestContext,
  answers: OnboardingAnswers = onboardingAnswers(),
): Promise<void> {
  const steps: Array<[string, 'put' | 'post', Record<string, unknown>]> = [
    ['profile', 'put', { firstName: 'E2E', lastName: 'Organizer', contactPhone: answers.contactPhone, organization: answers.organization }],
    ['mun', 'put', { munName: answers.munName, munCity: answers.munCity, munStartDate: answers.munStartDate }],
    [
      'details',
      'put',
      {
        expectedDelegateCount: answers.expectedDelegateCount,
        munDescription: answers.munDescription,
        previousEditions: answers.previousEditions,
        websiteUrl: answers.websiteUrl,
      },
    ],
    ['payment', 'put', { upiId: answers.upiId, upiPhone: answers.upiPhone }],
    ['agreement', 'post', { accepted: true }],
  ]
  for (const [step, method, data] of steps) {
    const res = await api[method](`organizer/onboarding/${step}`, { data })
    expect(res.status(), `${step}: ${await res.text()}`).toBe(200)
  }
}

export interface ApplicationResult {
  id: string
  munId: string
  status: string
}

export async function submitApplicationViaApi(api: APIRequestContext, conferenceName: string): Promise<ApplicationResult> {
  const res = await api.post('organizer/applications', {
    data: {
      conferenceName,
      location: 'Hyderabad',
      expectedDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      expectedDelegateCount: 150,
      description: 'An end-to-end test conference with two committees and a crisis cabinet.',
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as ApplicationResult
}

/** A short unique suffix so created entities never collide across runs. */
export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A sonner toast with the given text. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole('region', { name: /notifications/i }).getByText(text)
}
