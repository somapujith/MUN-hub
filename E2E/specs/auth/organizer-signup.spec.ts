import { expect, test, type Page } from '@playwright/test'
import {
  TEST_LOGIN_CODE,
  browserContextFor,
  newApiContext,
  seedOrganizerLoginCode,
  signInOrganizerViaApi,
  signUpViaApi,
} from '../../fixtures/api'
import { ACCOUNTS } from '../../fixtures/accounts'
import { uniqueEmail } from '../../fixtures/data'
import { expectSignedOutHeader, pageHeading, watchForCrashes } from '../../fixtures/ui'
import { codeInput, enterPlantedCode, freshOrganizer, sessionOf, sessionVia } from './_helpers'

/**
 * Passwordless organizer accounts (lib/actions/organizer-otp.ts). Signup
 * collects name, email, optional phone and consent, then an emailed 6-digit
 * code confirms the address; the account exists only once the code checks
 * out. Organizer and delegate accounts are separate: a delegate can never
 * become an organizer.
 */

/** Where a brand-new organizer lands. */
const NEW_ORGANIZER_LANDING = /\/organizer\/welcome$/

function main(page: Page) {
  return page.getByRole('main')
}

function input(page: Page, label: string) {
  return main(page).getByLabel(label, { exact: true })
}

async function fillDetails(page: Page, v: { name?: string; email: string; phone?: string; consent?: boolean }) {
  await input(page, 'Full name').fill(v.name ?? 'E2E Secretariat Lead')
  await input(page, 'Email address').fill(v.email)
  if (v.phone) await input(page, 'Phone (optional)').fill(v.phone)
  if (v.consent ?? true) {
    await main(page).getByRole('checkbox', { name: /terms of service/i }).click()
    await main(page).getByRole('checkbox', { name: /privacy policy/i }).click()
  }
}

async function sendCode(page: Page) {
  await main(page).getByRole('button', { name: 'Send OTP', exact: true }).click()
}

test.describe('organizer signup (UI)', () => {
  test('renders a short, organizer-only form with no password', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/organizer/signup')
    await expect(pageHeading(page)).toHaveText('Create your organizer account')
    for (const label of ['Full name', 'Email address', 'Phone (optional)']) {
      await expect(input(page, label)).toBeVisible()
    }
    await expect(main(page).getByLabel(/password/i)).toHaveCount(0)
    await expect(main(page).getByRole('checkbox', { name: /terms of service/i })).not.toBeChecked()
    await expect(main(page).getByRole('checkbox', { name: /privacy policy/i })).not.toBeChecked()
    // None of the delegate profile questions.
    await expect(main(page).getByLabel(/date of birth|emergency|guardian/i)).toHaveCount(0)
    await expect(main(page).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/organizer/login')
    crashes.assertNone()
  })

  test('details, then the emailed code, create an ORGANIZER and open the application', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const email = uniqueEmail('org-signup')
    await page.goto('/organizer/signup')
    await fillDetails(page, { email, phone: '9876500000' })
    await sendCode(page)

    // No account exists until the code is verified.
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    expect(await sessionOf(page)).toBeNull()
    await expect(main(page).getByRole('button', { name: 'Verify and create account' })).toBeDisabled()

    await enterPlantedCode(page, email)
    await expect(page).toHaveURL(NEW_ORGANIZER_LANDING)
    expect((await sessionOf(page))?.role).toBe('ORGANIZER')

    // The welcome page walks them into the host application.
    await expect(pageHeading(page)).toHaveText('Reach the right delegates, grow as you host')
    await page.getByRole('link', { name: 'Start your journey' }).click()
    await expect(page).toHaveURL(/\/organizer\/apply$/)
    await expect(pageHeading(page)).toHaveText('Host your MUN on MUN Hub')

    await page.goto('/organizer/dashboard')
    await expect(pageHeading(page)).toHaveText('Overview')
    await expect(main(page).getByRole('heading', { name: 'No conferences yet' })).toBeVisible()
    crashes.assertNone()
  })

  test('the welcome page is for organizers only, and its sign-out returns to the organizer door', async ({ browser, page }) => {
    await page.goto('/organizer/welcome')
    await expect(page).toHaveURL(/\/organizer\/login/)

    const student = await signUpViaApi()
    const delegateContext = await browserContextFor(browser, student)
    const delegatePage = await delegateContext.newPage()
    await delegatePage.goto('/organizer/welcome')
    await expect(pageHeading(delegatePage)).toHaveText('Access denied')
    await delegateContext.close()

    const organizer = await freshOrganizer()
    const context = await browserContextFor(browser, organizer)
    const organizerPage = await context.newPage()
    await organizerPage.goto('/organizer/welcome')
    await expect(pageHeading(organizerPage)).toHaveText('Reach the right delegates, grow as you host')
    await organizerPage.getByRole('button', { name: 'Sign out' }).click()
    await expect(organizerPage).toHaveURL(/\/organizer\/login$/)
    expect(await sessionOf(organizerPage)).toBeNull()
    await context.close()
  })

  test('a returning organizer goes to the dashboard, not the welcome page', async ({ page }) => {
    const organizer = await freshOrganizer()
    await organizer.api.dispose()
    await page.goto('/organizer/login')
    await input(page, 'Email address').fill(organizer.email)
    await sendCode(page)
    await enterPlantedCode(page, organizer.email)
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
  })

  test('?redirectTo= wins over the welcome page', async ({ page }) => {
    const email = uniqueEmail('org-redirect')
    await page.goto('/organizer/signup?redirectTo=%2Forganizer%2Fapply')
    await fillDetails(page, { email })
    await sendCode(page)
    await enterPlantedCode(page, email)
    await expect(page).toHaveURL(/\/organizer\/apply$/)
  })

  test('"Change" on the code step returns to the filled-in details', async ({ page }) => {
    const email = uniqueEmail('org-back')
    await page.goto('/organizer/signup')
    await fillDetails(page, { name: 'E2E Back Button', email, phone: '9876500001' })
    await sendCode(page)
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    await main(page).getByRole('button', { name: 'Change' }).click()
    await expect(pageHeading(page)).toHaveText('Create your organizer account')
    await expect(input(page, 'Full name')).toHaveValue('E2E Back Button')
    await expect(input(page, 'Email address')).toHaveValue(email)
    await expect(input(page, 'Phone (optional)')).toHaveValue('9876500001')
    await expect(main(page).getByRole('checkbox', { name: /terms of service/i })).toBeChecked()
  })

  test('a wrong code is refused and nothing is created', async ({ page }) => {
    const email = uniqueEmail('org-wrong')
    await page.goto('/organizer/signup')
    await fillDetails(page, { email })
    await sendCode(page)
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    await seedOrganizerLoginCode(email)
    await codeInput(page).fill('000000')
    await expect(main(page).getByRole('alert')).toHaveText('Incorrect code')
    expect(await sessionOf(page)).toBeNull()
    await expect(page).toHaveURL(/\/organizer\/signup$/)
  })

  test('client-side checks: name, email and consent', async ({ page }) => {
    const email = uniqueEmail('org-invalid')
    await page.goto('/organizer/signup')
    const alert = main(page).getByRole('alert')

    await fillDetails(page, { name: '   ', email })
    await sendCode(page)
    await expect(alert).toHaveText('Enter your full name.')

    await input(page, 'Full name').fill('E2E Secretariat Lead')
    await input(page, 'Email address').fill('not-an-email')
    await sendCode(page)
    await expect(alert).toHaveText('Enter a valid email address.')

    await page.goto('/organizer/signup')
    await fillDetails(page, { email, consent: false })
    await sendCode(page)
    await expect(alert).toHaveText('Accept the Terms of Service and Privacy Policy to continue.')
    await expect(input(page, 'Full name')).toHaveValue('E2E Secretariat Lead')
    await expect(input(page, 'Email address')).toHaveValue(email)
    await expect(pageHeading(page)).toHaveText('Create your organizer account')
    expect(await sessionOf(page)).toBeNull()
  })

  test('a delegate’s email cannot be used to create an organizer account', async ({ page }) => {
    const student = await signUpViaApi()
    await page.goto('/organizer/signup')
    await fillDetails(page, { email: student.email })
    await sendCode(page)
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    // No live code is ever issued for a delegate address.
    await codeInput(page).fill(TEST_LOGIN_CODE)
    await expect(main(page).getByRole('alert')).toHaveText('This code has expired. Request a new one')
    expect(await sessionOf(page)).toBeNull()
    expect((await sessionVia(student.api))?.role).toBe('STUDENT')
  })

  test('an already signed-in organizer is sent straight to the workspace, or to ?redirectTo=', async ({ browser }) => {
    const organizer = await freshOrganizer()
    const context = await browserContextFor(browser, organizer)
    const page = await context.newPage()
    for (const door of ['/organizer/signup', '/organizer/login']) {
      await page.goto(door)
      await expect(page).toHaveURL(/\/organizer\/dashboard$/)
    }
    await page.goto('/organizer/login?redirectTo=%2Forganizer%2Fapply')
    await expect(page).toHaveURL(/\/organizer\/apply$/)
    await context.close()
  })

  test('a signed-in delegate still sees the organizer form', async ({ browser }) => {
    const student = await signUpViaApi()
    const context = await browserContextFor(browser, student)
    const page = await context.newPage()
    await page.goto('/organizer/signup')
    await expect(pageHeading(page)).toHaveText('Create your organizer account')
    await expect(page).toHaveURL(/\/organizer\/signup$/)
    await context.close()
  })

  test('the organizer login and signup pages link to each other', async ({ page }) => {
    await page.goto('/organizer/login')
    await main(page).getByRole('link', { name: 'Create an organizer account' }).click()
    await expect(page).toHaveURL(/\/organizer\/signup$/)
    await main(page).getByRole('link', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/organizer\/login$/)
  })
})

test.describe('organizer login with an unknown email', () => {
  test('asks for details after the code, then creates the account', async ({ page }) => {
    const email = uniqueEmail('org-login-new')
    await page.goto('/organizer/login')
    await main(page).getByRole('textbox', { name: 'Email address' }).fill(email)
    await sendCode(page)
    await enterPlantedCode(page, email)

    await expect(pageHeading(page)).toHaveText('Create your organizer account')
    await expect(main(page)).toContainText(`There's no organizer account for ${email} yet`)
    expect(await sessionOf(page)).toBeNull()

    const create = main(page).getByRole('button', { name: 'Create account', exact: true })
    await input(page, 'Full name').fill('E2E Late Details')
    await create.click()
    await expect(main(page).getByRole('alert')).toHaveText('Accept the Terms of Service and Privacy Policy to continue.')

    await main(page).getByRole('checkbox', { name: /terms of service/i }).click()
    await main(page).getByRole('checkbox', { name: /privacy policy/i }).click()
    await create.click()
    await expect(page).toHaveURL(NEW_ORGANIZER_LANDING)
    expect((await sessionOf(page))?.role).toBe('ORGANIZER')
  })
})

test.describe('organizer code API', () => {
  test('requesting a code looks the same for new, organizer and delegate addresses', async () => {
    const student = await signUpViaApi()
    const organizer = await freshOrganizer()
    const api = await newApiContext()
    const responses = []
    for (const email of [uniqueEmail('org-probe'), organizer.email, student.email]) {
      const res = await api.post('auth/organizers/code', { data: { email } })
      responses.push({ status: res.status(), body: await res.text() })
    }
    expect(responses.map((r) => r.status)).toEqual([204, 204, 204])
    expect(new Set(responses.map((r) => r.body)).size).toBe(1)
    await api.dispose()
  })

  test('a second code inside a minute is refused (resend cooldown)', async () => {
    const api = await newApiContext()
    const email = uniqueEmail('org-cooldown')
    expect((await api.post('auth/organizers/code', { data: { email } })).status()).toBe(204)
    const again = await api.post('auth/organizers/code', { data: { email } })
    expect(again.status()).toBe(429)
    expect((await again.json()).error.code).toBe('RATE_LIMITED')
    await api.dispose()
  })

  test('a code works once', async () => {
    const organizer = await freshOrganizer()
    await seedOrganizerLoginCode(organizer.email)
    const api = await newApiContext()
    const first = await api.post('auth/organizers/session', { data: { email: organizer.email, code: TEST_LOGIN_CODE } })
    expect(first.status()).toBe(200)
    expect((await first.json()).isNewAccount).toBe(false)
    const replay = await (await newApiContext()).post('auth/organizers/session', {
      data: { email: organizer.email, code: TEST_LOGIN_CODE },
    })
    expect(replay.status()).toBe(400)
    await api.dispose()
  })

  test('five wrong guesses lock the code, even against the right one', async () => {
    const organizer = await freshOrganizer()
    await seedOrganizerLoginCode(organizer.email)
    const api = await newApiContext()
    const statuses: number[] = []
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await api.post('auth/organizers/session', { data: { email: organizer.email, code: '999999' } })).status())
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429])
    const right = await api.post('auth/organizers/session', { data: { email: organizer.email, code: TEST_LOGIN_CODE } })
    expect(right.status()).toBe(429)
    expect(await (await api.get('auth/session')).json()).toBeNull()
    await api.dispose()
  })

  test('an expired code is refused', async () => {
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', {
      data: { email: uniqueEmail('org-nocode'), code: TEST_LOGIN_CODE },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error.message).toBe('This code has expired. Request a new one')
    await api.dispose()
  })

  test('an unknown address with a valid code but no details is asked for them', async () => {
    const email = uniqueEmail('org-profile')
    await seedOrganizerLoginCode(email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', { data: { email, code: TEST_LOGIN_CODE } })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ status: 'PROFILE_REQUIRED' })
    expect(await (await api.get('auth/session')).json()).toBeNull()
    await api.dispose()
  })

  test('signup without consent is refused', async () => {
    const email = uniqueEmail('org-noconsent')
    await seedOrganizerLoginCode(email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', {
      data: {
        email,
        code: TEST_LOGIN_CODE,
        profile: { name: 'No Consent', acceptedTermsOfService: true, acceptedPrivacyPolicy: false },
      },
    })
    expect(res.status()).toBe(400)
    expect(await (await api.get('auth/session')).json()).toBeNull()
    await api.dispose()
  })

  test('even with a valid code, a delegate account is never turned into an organizer', async () => {
    const student = await signUpViaApi()
    await seedOrganizerLoginCode(student.email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', {
      data: {
        email: student.email,
        code: TEST_LOGIN_CODE,
        profile: { name: 'Hijack Attempt', acceptedTermsOfService: true, acceptedPrivacyPolicy: true },
      },
    })
    expect(res.status()).toBe(403)
    expect(await (await api.get('auth/session')).json()).toBeNull()
    expect((await sessionVia(student.api))?.role).toBe('STUDENT')
    await api.dispose()
  })

  test('signing up with an existing organizer email signs into that account instead of duplicating it', async () => {
    const organizer = await freshOrganizer()
    await seedOrganizerLoginCode(organizer.email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', {
      data: {
        email: organizer.email.toUpperCase(),
        code: TEST_LOGIN_CODE,
        profile: { name: 'Someone Else', acceptedTermsOfService: true, acceptedPrivacyPolicy: true },
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'SIGNED_IN', userId: organizer.userId, isNewAccount: false })
    await api.dispose()
  })

  test('the seeded organizer can sign in with a code', async () => {
    const session = await signInOrganizerViaApi(ACCOUNTS.organizer.email)
    expect((await sessionVia(session.api))?.role).toBe('ORGANIZER')
    await session.api.dispose()
  })
})

test.describe('a signed-in delegate has no path to organizer registration', () => {
  test('no "List your MUN" anywhere, and the application page is denied', async ({ browser }) => {
    const student = await signUpViaApi()
    const context = await browserContextFor(browser, student)
    const page = await context.newPage()

    await page.goto('/')
    await expect(pageHeading(page)).toHaveText(/Model UN conferences/)
    await expect(page.getByRole('button', { name: /account menu \(delegate\)/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /list your mun/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /list your mun/i })).toHaveCount(0)
    await expect(page.getByText('List your conference where delegates are already looking.')).toHaveCount(0)
    await expect(page.getByRole('contentinfo').getByRole('link', { name: /list your mun/i })).toHaveCount(0)

    await page.getByRole('button', { name: /account menu/i }).click()
    await expect(page.getByRole('menu')).not.toContainText(/organizer|host|list your mun/i)
    await page.keyboard.press('Escape')

    await page.goto('/organizer/apply')
    await expect(pageHeading(page)).toHaveText('Access denied')
    await expect(main(page)).toContainText("isn't an organizer account")
    await expect(main(page).getByRole('textbox', { name: 'Conference name' })).toHaveCount(0)
    await context.close()
  })

  test('POST organizer/applications returns 403 for a delegate', async () => {
    const student = await signUpViaApi()
    const res = await student.api.post('organizer/applications', {
      data: {
        conferenceName: 'Delegate Sneak MUN',
        expectedDate: new Date(Date.now() + 120 * 86_400_000).toISOString(),
        location: 'Hyderabad',
        expectedDelegateCount: 100,
        description: 'Should never be accepted',
      },
    })
    expect(res.status()).toBe(403)
    expect((await sessionVia(student.api))?.role).toBe('STUDENT')
  })

  test('POST organizer/applications returns 401 when signed out', async ({ page }) => {
    const api = await newApiContext()
    const res = await api.post('organizer/applications', {
      data: {
        conferenceName: 'Anonymous MUN',
        expectedDate: new Date(Date.now() + 120 * 86_400_000).toISOString(),
        location: 'Hyderabad',
        expectedDelegateCount: 100,
        description: 'Should never be accepted',
      },
    })
    expect(res.status()).toBe(401)
    await api.dispose()

    await page.goto('/')
    await expectSignedOutHeader(page)
  })
})
