import { expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  TEST_LOGIN_CODE,
  seedOrganizerLoginCode,
  signUpOrganizerViaApi,
  signUpViaApi,
  type ApiSession,
} from '../../fixtures/api'
import { ADULT_DOB, uniqueEmail } from '../../fixtures/data'
import { emailsTo, linkIn } from '../../fixtures/outbox'
import { API_URL } from '../../env'

export const FRESH_PASSWORD = 'e2e-strong-password'

/** A brand-new STUDENT whose credentials can be typed into a login form (the API session is discarded). */
export async function freshStudent(): Promise<{ email: string; password: string }> {
  const session = await signUpViaApi()
  await session.api.dispose()
  return { email: session.email, password: session.password }
}

/** A brand-new ORGANIZER (passwordless), still signed in on `api`. */
export async function freshOrganizer(): Promise<ApiSession> {
  return signUpOrganizerViaApi()
}

// Organizer email-code forms (/organizer/login, /organizer/signup).

/** The code input; the form submits itself once all six digits are in. */
export function codeInput(page: Page) {
  return page.getByRole('main').getByLabel('6-digit code', { exact: true })
}

/** After "Send OTP" was clicked: waits for the code step, plants a known code, and types it. */
export async function enterPlantedCode(page: Page, email: string) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter OTP')
  await seedOrganizerLoginCode(email)
  await codeInput(page).fill(TEST_LOGIN_CODE)
}

/** GET /auth/session with the page's own cookies (page.request shares the browser context's cookie jar). */
export async function sessionOf(page: Page): Promise<{ userId: string; role: string } | null> {
  const response = await page.request.get(`${API_URL}/auth/session`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as { userId: string; role: string } | null
}

export async function sessionVia(api: APIRequestContext): Promise<{ userId: string; role: string } | null> {
  const response = await api.get('auth/session')
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as { userId: string; role: string } | null
}

/** The password login form's submit button on /login and /admin/login. */
export function loginSubmit(page: Page) {
  return page.getByRole('main').getByRole('button', { name: /^sign in$/i })
}

export async function submitLogin(page: Page, email: string, password: string) {
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await loginSubmit(page).click()
}

/**
 * The token from the newest reset link emailed to an account, read from the
 * local API's email outbox (fixtures/outbox.ts). The database only stores the
 * token's SHA-256 (lib/auth/opaque-token.ts), so the email is the one place a
 * usable token exists.
 */
export async function latestResetToken(email: string): Promise<string | null> {
  const mail = (await emailsTo(email)).filter((message) => message.text.includes('/reset-password')).at(-1)
  return mail ? linkIn(mail, '/reset-password').searchParams.get('token') : null
}

// Delegate signup form (/signup).

export interface SignupValues {
  name: string
  email: string
  password: string
  confirmPassword: string
  dob: string
  gender: string
  phone: string
  address: string
  institution: string
  year: string
  ecName: string
  ecPhone: string
  ecRelation: string
  consent: boolean
}

export function signupValues(overrides: Partial<SignupValues> = {}): SignupValues {
  return {
    name: 'E2E Signup Delegate',
    email: uniqueEmail('signup'),
    password: 'e2e-strong-password',
    confirmPassword: overrides.password ?? 'e2e-strong-password',
    dob: ADULT_DOB,
    gender: 'Prefer not to say',
    phone: '9876501234',
    address: '42 Test Lane, Hyderabad',
    institution: 'E2E Test University',
    year: '2nd year',
    ecName: 'E2E Guardian',
    ecPhone: '9876505678',
    ecRelation: 'Parent',
    consent: true,
    ...overrides,
  }
}

export function signupField(page: Page, label: string) {
  return page.getByRole('main').getByLabel(label, { exact: true })
}

export function consentBox(page: Page, name: RegExp) {
  return page.getByRole('main').getByRole('checkbox', { name })
}

export async function fillSignup(page: Page, v: SignupValues) {
  await signupField(page, 'Full name *').fill(v.name)
  await signupField(page, 'Email address *').fill(v.email)
  await signupField(page, 'Password *').fill(v.password)
  await signupField(page, 'Confirm password *').fill(v.confirmPassword)
  await signupField(page, 'Date of birth *').fill(v.dob)
  await signupField(page, 'Gender *').fill(v.gender)
  await signupField(page, 'Primary mobile number *').fill(v.phone)
  await signupField(page, 'Residential address *').fill(v.address)
  await signupField(page, 'School / college / university *').fill(v.institution)
  await signupField(page, 'Year of study *').fill(v.year)
  await signupField(page, 'Parent / guardian name *').fill(v.ecName)
  await signupField(page, 'Contact number *').fill(v.ecPhone)
  await signupField(page, 'Relationship *').fill(v.ecRelation)
  if (v.consent) {
    await consentBox(page, /terms of service/i).check()
    await consentBox(page, /privacy policy/i).check()
  }
}

export async function submitSignup(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Create account', exact: true }).click()
}

