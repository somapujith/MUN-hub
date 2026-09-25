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
 * Passwordless organizer accounts (lib/actions/organizer-otp.ts). There is no
 * separate "sign up": /organizer/login is the only door. An email, then an
 * emailed 6-digit code — the account is created the moment the code checks
 * out for an address that doesn't have one yet, with a placeholder name (the
 * onboarding wizard's profile step collects the real one). Organizer and
 * delegate accounts are separate: a delegate can never become an organizer.
 */

/** Where a brand-new organizer lands. */
const NEW_ORGANIZER_LANDING = /\/organizer\/welcome$/

function main(page: Page) {
  return page.getByRole('main')
}

function input(page: Page, label: string) {
  return main(page).getByLabel(label, { exact: true })
}

async function sendCode(page: Page, email: string) {
  await input(page, 'Email address').fill(email)
  await main(page).getByRole('button', { name: 'Send OTP', exact: true }).click()
}

test.describe('organizer login (UI)', () => {
  test('renders a short, organizer-only form with no password and no signup fields', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/organizer/login')
    await expect(pageHeading(page)).toHaveText('Log in')
    await expect(input(page, 'Email address')).toBeVisible()
    await expect(main(page).getByLabel(/password/i)).toHaveCount(0)
    // None of the old signup-step fields exist anymore.
    await expect(main(page).getByLabel(/full name/i)).toHaveCount(0)
    await expect(main(page).getByLabel(/phone/i)).toHaveCount(0)
    await expect(main(page).getByRole('checkbox')).toHaveCount(0)
    await expect(main(page).getByRole('link', { name: 'Terms of Service' })).toBeVisible()
    await expect(main(page).getByRole('link', { name: 'Privacy Policy' })).toBeVisible()
    crashes.assertNone()
  })

  test('logging in with an unknown address creates an ORGANIZER and opens the application', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const email = uniqueEmail('org-login-new')
    await page.goto('/organizer/login')
    await sendCode(page, email)

    // No account exists until the code is verified.
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    expect(await sessionOf(page)).toBeNull()
    await expect(main(page).getByRole('button', { name: 'Verify' })).toBeDisabled()

    await enterPlantedCode(page, email)
    await expect(page).toHaveURL(NEW_ORGANIZER_LANDING)
    expect((await sessionOf(page))?.role).toBe('ORGANIZER')

    // The welcome page walks them into the onboarding wizard, which the apply page also redirects to.
    await expect(pageHeading(page)).toHaveText('Reach the right delegates, grow as you host')
    await page.getByRole('link', { name: 'Start your journey' }).click()
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)
    await expect(pageHeading(page)).toHaveText('Create your organizer profile')
    await page.goto('/organizer/apply')
    await expect(page).toHaveURL(/\/organizer\/onboarding$/)

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
    await sendCode(page, organizer.email)
    await enterPlantedCode(page, organizer.email)
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
  })

  test('?redirectTo= wins over the welcome page', async ({ page }) => {
    const email = uniqueEmail('org-redirect')
    await page.goto('/organizer/login?redirectTo=%2Forganizer%2Fsupport')
    await sendCode(page, email)
    await enterPlantedCode(page, email)
    await expect(page).toHaveURL(/\/organizer\/support$/)
  })

  test('"Change" on the code step returns to the email step with the address filled in', async ({ page }) => {
    const email = uniqueEmail('org-back')
    await page.goto('/organizer/login')
    await sendCode(page, email)
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    await main(page).getByRole('button', { name: 'Change' }).click()
    await expect(pageHeading(page)).toHaveText('Log in')
    await expect(input(page, 'Email address')).toHaveValue(email)
  })

  test('a wrong code is refused and nothing is created', async ({ page }) => {
    const email = uniqueEmail('org-wrong')
    await page.goto('/organizer/login')
    await sendCode(page, email)
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    await seedOrganizerLoginCode(email)
    await codeInput(page).fill('000000')
    await expect(main(page).getByRole('alert')).toHaveText('Incorrect code')
    expect(await sessionOf(page)).toBeNull()
    await expect(page).toHaveURL(/\/organizer\/login$/)
  })

  test('the email field rejects an invalid address before sending', async ({ page }) => {
    await page.goto('/organizer/login')
    const send = main(page).getByRole('button', { name: 'Send OTP', exact: true })
    await expect(send).toBeDisabled()
    await input(page, 'Email address').fill('not-an-email')
    await expect(send).toBeDisabled()
  })

  test('a delegate’s email cannot be used to log in as an organizer', async ({ page }) => {
    const student = await signUpViaApi()
    await page.goto('/organizer/login')
    await sendCode(page, student.email)
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
    await page.goto('/organizer/login?redirectTo=%2Forganizer%2Fsupport')
    await expect(page).toHaveURL(/\/organizer\/support$/)
    await context.close()
  })

  test('a signed-in delegate still sees the organizer login form', async ({ browser }) => {
    const student = await signUpViaApi()
    const context = await browserContextFor(browser, student)
    const page = await context.newPage()
    await page.goto('/organizer/login')
    await expect(pageHeading(page)).toHaveText('Log in')
    await expect(page).toHaveURL(/\/organizer\/login$/)
    await context.close()
  })

  test('/organizer/signup is a dead link that redirects straight to /organizer/login, keeping ?redirectTo=', async ({ page }) => {
    await page.goto('/organizer/signup?redirectTo=%2Forganizer%2Fsupport')
    await expect(page).toHaveURL(/\/organizer\/login\?redirectTo=%2Forganizer%2Fsupport$/)
    await expect(pageHeading(page)).toHaveText('Log in')
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

  test('an unknown address with a valid code creates the account outright — no separate signup step', async () => {
    const email = uniqueEmail('org-new')
    await seedOrganizerLoginCode(email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', { data: { email, code: TEST_LOGIN_CODE } })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'SIGNED_IN', role: 'ORGANIZER', isNewAccount: true })
    expect((await (await api.get('auth/session')).json())?.role).toBe('ORGANIZER')
    await api.dispose()
  })

  test('a smuggled `profile` field on the session call is rejected', async () => {
    const email = uniqueEmail('org-smuggle')
    await seedOrganizerLoginCode(email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', {
      data: { email, code: TEST_LOGIN_CODE, profile: { name: 'Smuggled Name' } },
    })
    expect(res.status()).toBe(400)
    expect(await (await api.get('auth/session')).json()).toBeNull()
    await api.dispose()
  })

  test('even with a valid code, a delegate account is never turned into an organizer', async () => {
    const student = await signUpViaApi()
    await seedOrganizerLoginCode(student.email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', { data: { email: student.email, code: TEST_LOGIN_CODE } })
    expect(res.status()).toBe(403)
    expect(await (await api.get('auth/session')).json()).toBeNull()
    expect((await sessionVia(student.api))?.role).toBe('STUDENT')
    await api.dispose()
  })

  test('logging in with an existing organizer email signs into that account instead of duplicating it', async () => {
    const organizer = await freshOrganizer()
    await seedOrganizerLoginCode(organizer.email)
    const api = await newApiContext()
    const res = await api.post('auth/organizers/session', {
      data: { email: organizer.email.toUpperCase(), code: TEST_LOGIN_CODE },
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

    for (const path of ['/organizer/apply', '/organizer/onboarding']) {
      await page.goto(path)
      await expect(pageHeading(page)).toHaveText('Access denied')
      await expect(main(page)).toContainText("isn't an organizer account")
      await expect(main(page).getByRole('textbox', { name: 'Title of your MUN' })).toHaveCount(0)
    }
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
