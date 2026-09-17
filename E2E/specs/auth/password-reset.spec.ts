import { expect, test, type Page } from '@playwright/test'
import { newApiContext, signUpViaApi } from '../../fixtures/api'
import { uniqueEmail } from '../../fixtures/data'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { latestResetToken, sessionOf, sessionVia, submitLogin } from './_helpers'

/**
 * Forgot / reset password. Reset links are only printed to the API console,
 * so the full-reset test reads the token from the local test database
 * (read-only).
 */

const NEW_PASSWORD = 'e2e-brand-new-password'

function main(page: Page) {
  return page.getByRole('main')
}

async function requestReset(page: Page, email: string) {
  await page.goto('/forgot-password')
  await expect(pageHeading(page)).toHaveText('Forgot your password?')
  await main(page).getByRole('textbox', { name: 'Email address' }).fill(email)
  await main(page).getByRole('button', { name: 'Send reset link' }).click()
  await expect(pageHeading(page)).toHaveText('Check your email')
}

async function chooseNewPassword(page: Page, password: string, confirm = password) {
  await main(page).getByLabel('New password', { exact: true }).fill(password)
  await main(page).getByLabel('Confirm new password', { exact: true }).fill(confirm)
  await main(page).getByRole('button', { name: 'Reset password' }).click()
}

test.describe('forgot password', () => {
  test('a known and an unknown email get the same confirmation', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const student = await signUpViaApi()
    const unknown = uniqueEmail('nobody')

    await requestReset(page, student.email)
    const known = (await main(page).innerText()).replace(student.email, '<email>')

    await requestReset(page, unknown)
    const notKnown = (await main(page).innerText()).replace(unknown, '<email>')

    expect(notKnown).toBe(known)
    await expect(main(page)).toContainText(`If an account exists for ${unknown}`)
    await expect(main(page)).toContainText('It expires in 1 hour and can only be used once.')
    crashes.assertNone()
  })

  test('the API answers a known and an unknown email identically', async () => {
    const student = await signUpViaApi()
    const api = await newApiContext()
    const known = await api.post('password-reset/request', { data: { email: student.email } })
    const unknown = await api.post('password-reset/request', { data: { email: uniqueEmail('nobody') } })
    expect(known.status()).toBe(204)
    expect(unknown.status()).toBe(204)
    expect(await unknown.text()).toBe(await known.text())
    await api.dispose()
  })

  test('"Back to sign in" links work before and after submitting', async ({ page }) => {
    await page.goto('/forgot-password')
    await main(page).getByRole('link', { name: 'Back to sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await requestReset(page, uniqueEmail('nobody'))
    await main(page).getByRole('button', { name: 'Back to sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('reset password page', () => {
  test('without a token it shows the invalid-link state', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(pageHeading(page)).toHaveText('Invalid reset link')
    await expect(main(page).getByLabel('New password', { exact: true })).toHaveCount(0)
    await main(page).getByRole('button', { name: 'Request a new link' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
  })

  test('a bogus token is refused as invalid or expired', async ({ page }) => {
    await page.goto('/reset-password?token=bogus-e2e-token')
    await expect(pageHeading(page)).toHaveText('Choose a new password')
    await chooseNewPassword(page, NEW_PASSWORD)
    await expect(main(page).getByRole('alert')).toHaveText('This reset link is invalid or has expired')
    await expect(page).toHaveURL(/\/reset-password\?token=bogus-e2e-token$/)
  })

  test('mismatched or short new passwords are refused before anything is sent', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('password-reset/confirm')) requests.push(r.url())
    })
    await page.goto('/reset-password?token=bogus-e2e-token')

    await chooseNewPassword(page, NEW_PASSWORD, `${NEW_PASSWORD}-typo`)
    await expect(main(page).getByRole('alert')).toHaveText('Passwords do not match.')

    // The inputs carry minLength, so the browser itself blocks a short one.
    await page.reload()
    await chooseNewPassword(page, 'short', 'short')
    const newPassword = main(page).getByLabel('New password', { exact: true })
    await expect
      .poll(async () =>
        (await main(page).getByRole('alert').count())
          ? await main(page).getByRole('alert').innerText()
          : await newPassword.evaluate((el) => ((el as HTMLInputElement).validity.tooShort ? 'tooShort' : 'valid')),
      )
      .toMatch(/^(Password must be at least 8 characters\.|tooShort)$/)
    await expect(page).toHaveURL(/\/reset-password\?token=bogus-e2e-token$/)

    expect(requests).toEqual([])
  })
})

test.describe('full reset', () => {
  test('a real reset link sets the new password, kills old sessions and cannot be reused', async ({ page }) => {
    const student = await signUpViaApi()
    expect((await sessionVia(student.api))?.role).toBe('STUDENT')

    await requestReset(page, student.email)
    let token: string | null = null
    await expect.poll(async () => (token = await latestResetToken(student.email))).not.toBeNull()

    await page.goto(`/reset-password?token=${token}`)
    await chooseNewPassword(page, NEW_PASSWORD)
    await expect(page).toHaveURL(/\/login\?reset=success$/)
    // The reset signs nobody in.
    expect(await sessionOf(page)).toBeNull()

    // Every session that existed before the reset is gone.
    expect(await sessionVia(student.api)).toBeNull()

    // The old password no longer works; the new one does.
    await submitLogin(page, student.email, student.password)
    await expect(main(page).getByRole('alert')).toHaveText('Invalid email or password')
    await submitLogin(page, student.email, NEW_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
    expect((await sessionOf(page))?.role).toBe('STUDENT')

    // The link is single-use.
    const api = await newApiContext()
    const reuse = await api.post('password-reset/confirm', { data: { token, newPassword: 'another-password-1' } })
    expect(reuse.status()).toBe(400)
    expect((await reuse.json()).error.message).toBe('This reset link is invalid or has expired')
    await api.dispose()
  })

  test('after a successful reset the login page confirms it', async ({ page }) => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: reset-password-page.tsx navigates to /login?reset=success but login-page.tsx never reads ?reset= — the retired Next /login showed a success banner, the SPA shows nothing',
    )
    const student = await signUpViaApi()
    const api = await newApiContext()
    await api.post('password-reset/request', { data: { email: student.email } })
    let token: string | null = null
    await expect.poll(async () => (token = await latestResetToken(student.email))).not.toBeNull()
    await api.dispose()

    await page.goto(`/reset-password?token=${token}`)
    await chooseNewPassword(page, NEW_PASSWORD)
    await expect(page).toHaveURL(/\/login\?reset=success$/)
    await expect(pageHeading(page)).toHaveText('Welcome back')
    await expect(main(page)).toContainText(/password (has been |was )?(reset|updated|changed)/i, { timeout: 5_000 })
  })
})
