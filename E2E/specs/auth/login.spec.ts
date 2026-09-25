import { expect, test, type Page } from '@playwright/test'
import { ACCOUNTS, DEMO_PASSWORD } from '../../fixtures/accounts'
import { API_URL, WEB_URL } from '../../env'
import {
  accountMenuButton,
  expectSignedInHeader,
  expectSignedOutHeader,
  pageHeading,
  signOutThroughUi,
  watchForCrashes,
} from '../../fixtures/ui'
import { browserContextFor, newApiContext } from '../../fixtures/api'
import { uniqueEmail } from '../../fixtures/data'
import {
  codeInput,
  enterPlantedCode,
  freshOrganizer,
  freshStudent,
  loginSubmit,
  sessionOf,
  submitLogin,
} from './_helpers'

/**
 * The three login doors: /login and /admin/login take a password,
 * /organizer/login an emailed 6-digit code.
 *
 * Every test signs in a FRESH account created through the API so the login
 * rate limit (5/min per account) is never hit; the seeded admin is used
 * exactly once, because a fresh admin can't be created.
 */

function main(page: Page) {
  return page.getByRole('main')
}

function loginError(page: Page) {
  return main(page).getByRole('alert')
}

test.describe('the three doors render', () => {
  test('/login — the general door', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/login')
    await expect(pageHeading(page)).toHaveText('Welcome back')
    await expect(main(page).getByRole('textbox', { name: 'Email address' })).toBeVisible()
    await expect(main(page).getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
    await expect(main(page).getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
    await expect(main(page).getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    await expect(main(page).getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup')
    await expect(main(page).getByRole('link', { name: 'Organizer sign in' })).toHaveAttribute('href', '/organizer/login')
    await expectSignedOutHeader(page)
    crashes.assertNone()
  })

  test('/organizer/login — the passwordless organizer door', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/organizer/login')
    await expect(pageHeading(page)).toHaveText('Log in')
    await expect(main(page)).toContainText('to publish your MUN')
    const email = main(page).getByRole('textbox', { name: 'Email address' })
    await expect(email).toBeVisible()
    // Organizers have no password.
    await expect(main(page).getByLabel(/password/i)).toHaveCount(0)
    await expect(main(page).getByRole('link', { name: 'Forgot password?' })).toHaveCount(0)
    const send = main(page).getByRole('button', { name: 'Send OTP', exact: true })
    await expect(send).toBeDisabled()
    await email.fill('not-an-email')
    await expect(send).toBeDisabled()
    await email.fill('someone@e2e.munhub.test')
    await expect(send).toBeEnabled()
    // No separate signup: an unrecognized address's account is created the
    // moment its code checks out, so there's nothing to switch to here.
    await expect(main(page).getByRole('link', { name: 'Create an organizer account' })).toHaveCount(0)
    // No marketplace chrome on the organizer entrance.
    await expect(page.getByRole('banner')).toHaveCount(0)
    crashes.assertNone()
  })

  test('/admin/login — the staff door, with no marketplace chrome or signup link', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(pageHeading(page)).toHaveText('Staff sign in')
    await expect(main(page).getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByRole('banner')).toHaveCount(0)
    await expect(main(page).getByRole('link', { name: /create an account/i })).toHaveCount(0)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })
})

test.describe('each door signs in the right role', () => {
  test('/login signs a delegate in and lands on the dashboard', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/login')
    await submitLogin(page, student.email, student.password)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expectSignedInHeader(page, 'Delegate')
    expect((await sessionOf(page))?.role).toBe('STUDENT')
  })

  test('/login accepts the email in any case', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/login')
    await submitLogin(page, `  ${student.email.toUpperCase()}`, student.password)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('/organizer/login signs an organizer in with an emailed code and lands in the workspace', async ({ page }) => {
    const organizer = await freshOrganizer()
    await organizer.api.dispose()
    await page.goto('/organizer/login')
    await main(page).getByRole('textbox', { name: 'Email address' }).fill(organizer.email)
    await main(page).getByRole('button', { name: 'Send OTP', exact: true }).click()
    await expect(main(page)).toContainText(`Sent to ${organizer.email}`)
    await enterPlantedCode(page, organizer.email)
    await expect(page).toHaveURL(/\/organizer\/dashboard$/)
    await expect(pageHeading(page)).toHaveText('Overview')
    expect((await sessionOf(page))?.role).toBe('ORGANIZER')
  })

  test('the code step lets the organizer go back and change the email', async ({ page }) => {
    const email = uniqueEmail('org-change')
    await page.goto('/organizer/login')
    await main(page).getByRole('textbox', { name: 'Email address' }).fill(email)
    await main(page).getByRole('button', { name: 'Send OTP', exact: true }).click()
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    // The resend link stays locked for a minute.
    await expect(main(page)).toContainText(/Resend OTP in 0:\d\d/)
    await main(page).getByRole('button', { name: 'Change' }).click()
    await expect(pageHeading(page)).toHaveText('Log in')
    await expect(main(page).getByRole('textbox', { name: 'Email address' })).toHaveValue(email)
  })

  test('a password never signs an organizer in', async () => {
    const organizer = await freshOrganizer()
    const api = await newApiContext()
    const res = await api.post('auth/session', { data: { email: organizer.email, password: 'any-password-at-all' } })
    expect(res.status()).toBe(401)
    expect(await (await api.get('auth/session')).json()).toBeNull()
    await api.dispose()
  })

  test('/admin/login signs staff in and lands in the admin console', async ({ page }) => {
    await page.goto('/admin/login')
    await submitLogin(page, ACCOUNTS.admin.email, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/admin$/)
    expect((await sessionOf(page))?.role).toBe('ADMIN')
  })
})

test.describe('failed sign-in', () => {
  test('a wrong password and an unknown email show the same generic error', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/login')

    await submitLogin(page, student.email, 'definitely-not-the-password')
    await expect(loginError(page)).toHaveText('Invalid email or password')
    const wrongPassword = await loginError(page).textContent()
    await expect(page).toHaveURL(/\/login$/)
    await expect(main(page).getByRole('textbox', { name: 'Email address' })).toHaveAttribute('aria-invalid', 'true')

    await submitLogin(page, `nobody-${Date.now()}@e2e.munhub.test`, 'definitely-not-the-password')
    await expect(loginError(page)).toHaveText('Invalid email or password')
    expect(await loginError(page).textContent()).toBe(wrongPassword)
    await expect(page).toHaveURL(/\/login$/)
    expect(await sessionOf(page)).toBeNull()
  })

  test('the API answers a wrong password and an unknown email identically', async ({ request }) => {
    const student = await freshStudent()
    const headers = { Origin: WEB_URL }
    const wrong = await request.post(`${API_URL}/auth/session`, {
      headers,
      data: { email: student.email, password: 'definitely-not-the-password' },
    })
    const unknown = await request.post(`${API_URL}/auth/session`, {
      headers,
      data: { email: `nobody-${Date.now()}@e2e.munhub.test`, password: 'definitely-not-the-password' },
    })
    expect(unknown.status()).toBe(wrong.status())
    expect(wrong.status()).toBeGreaterThanOrEqual(400)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  test('an empty form does not sign anyone in', async ({ page }) => {
    await page.goto('/login')
    await loginSubmit(page).click()
    await expect(loginError(page)).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('redirect after sign-in', () => {
  test('?redirectTo= is honored', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/login?redirectTo=%2Fprofile')
    await submitLogin(page, student.email, student.password)
    await expect(page).toHaveURL(/\/profile$/)
  })

  test('a protected page bounces to login and returns there after sign-in', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/dashboard/support')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard%2Fsupport$/)
    await submitLogin(page, student.email, student.password)
    await expect(page).toHaveURL(/\/dashboard\/support$/)
  })

  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
    test(`an off-site redirectTo (${target}) is not followed`, async ({ page }) => {
      const student = await freshStudent()
      await page.goto(`/login?redirectTo=${encodeURIComponent(target)}`)
      // The generic subtitle means the page did not treat it as a destination.
      await expect(main(page)).toContainText('Sign in to register for conferences')
      await submitLogin(page, student.email, student.password)
      await expect(page).toHaveURL(`${WEB_URL}/dashboard`)
      expect(new URL(page.url()).origin).toBe(WEB_URL)
    })
  }

  test('unauthenticated organizer and delegate pages bounce to their own doors', async ({ page }) => {
    await page.goto('/organizer/dashboard')
    await expect(page).toHaveURL(/\/organizer\/login\?redirectTo=%2Forganizer%2Fdashboard$/)
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprofile$/)
  })

  test('an unauthenticated admin page bounces to the staff door', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login\?redirectTo=%2Fadmin$/, { timeout: 5_000 })
  })
})

test.describe('wrong door', () => {
  test('a delegate email on the organizer door never gets a usable code', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/organizer/login')
    await main(page).getByRole('textbox', { name: 'Email address' }).fill(student.email)
    await main(page).getByRole('button', { name: 'Send OTP', exact: true }).click()
    // Same screen as for any address, so the door can't be used to probe accounts.
    await expect(pageHeading(page)).toHaveText('Enter OTP')
    await codeInput(page).fill('123456')
    await expect(main(page).getByRole('alert')).toHaveText('This code has expired. Request a new one')
    expect(await sessionOf(page)).toBeNull()
  })

  test('a signed-in organizer cannot use the staff door or the console', async ({ browser }) => {
    const organizer = await freshOrganizer()
    const context = await browserContextFor(browser, organizer)
    const page = await context.newPage()
    // Organizers have no password, so the staff form can never sign one in.
    await page.goto('/admin/login')
    await submitLogin(page, organizer.email, 'any-password-at-all')
    await expect(main(page).getByRole('alert')).toHaveText('Invalid email or password')
    await page.goto('/admin')
    await expect(pageHeading(page)).toHaveText('Access denied')
    await context.close()
  })

  test('a delegate on the staff door is not let into the console', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/admin/login')
    await submitLogin(page, student.email, student.password)
    await expect(pageHeading(page)).toHaveText("You're signed in")
    await page.goto('/admin')
    await expect(pageHeading(page)).toHaveText('Access denied')
  })
})

test.describe('sign out', () => {
  test('signing out returns to a signed-out header and protected pages bounce again', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/login')
    await submitLogin(page, student.email, student.password)
    await expect(page).toHaveURL(/\/dashboard$/)

    await accountMenuButton(page).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Dashboard' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'My registrations' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Profile & account' })).toBeVisible()
    await page.keyboard.press('Escape')

    await signOutThroughUi(page)
    await expect(page).toHaveURL(`${WEB_URL}/`)
    await expectSignedOutHeader(page)
    expect(await sessionOf(page)).toBeNull()

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard$/)
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprofile$/)
  })

  test('the old session cookie is dead after sign-out', async ({ page }) => {
    const student = await freshStudent()
    await page.goto('/login')
    await submitLogin(page, student.email, student.password)
    await expect(page).toHaveURL(/\/dashboard$/)
    const cookies = await page.context().cookies()

    await signOutThroughUi(page)
    await expectSignedOutHeader(page)

    // Replaying the pre-sign-out cookies must not restore the session.
    await page.context().addCookies(cookies)
    expect(await sessionOf(page)).toBeNull()
  })
})

test.describe('forgot password link', () => {
  test('"Forgot password?" opens the reset request page', async ({ page }) => {
    await page.goto('/login')
    await main(page).getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await expect(pageHeading(page)).toHaveText('Forgot your password?')
  })
})
