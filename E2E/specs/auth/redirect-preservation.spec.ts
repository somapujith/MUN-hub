import { expect, test, type Page } from '@playwright/test'
import { OPEN } from '../../fixtures/fixture-muns'
import { expectSignedInHeader, pageHeading, watchForCrashes } from '../../fixtures/ui'
import { fillSignup, freshStudent, sessionOf, signupValues, submitLogin, submitSignup } from './_helpers'

/**
 * "A Register click for MUN A must always return to MUN A" (PRD §5, §17, §31, §34).
 */

const REGISTER_PATH = `/register/${OPEN.slug}`

function main(page: Page) {
  return page.getByRole('main')
}

function redirectTarget(page: Page) {
  return new URL(page.url()).searchParams.get('redirectTo')
}

async function clickRegisterSignedOut(page: Page) {
  await page.goto(`/mun/${OPEN.slug}`)
  await expect(pageHeading(page)).toHaveText(OPEN.name)
  await main(page).getByRole('button', { name: 'Register now' }).click()
  await expect(page).toHaveURL(/\/login\?redirectTo=/)
  expect(redirectTarget(page)).toBe(REGISTER_PATH)
}

async function expectOnRegistration(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${REGISTER_PATH}$`))
  await expect(pageHeading(page)).toHaveText(OPEN.name)
  await expect(main(page).getByRole('heading', { name: 'Choose your registration' })).toBeVisible()
}

test.describe('the selected MUN survives authentication', () => {
  test('Register → sign in → that MUN’s registration', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const student = await freshStudent()
    await clickRegisterSignedOut(page)
    await expect(main(page)).toContainText('Sign in to continue to your registration.')

    await submitLogin(page, student.email, student.password)
    await expectOnRegistration(page)
    await expectSignedInHeader(page, 'Delegate')
    crashes.assertNone()
  })

  test('Register → Create account → sign up → that MUN’s registration', async ({ page }) => {
    await clickRegisterSignedOut(page)
    await main(page).getByRole('link', { name: 'Create an account' }).click()
    await expect(page).toHaveURL(/\/signup\?redirectTo=/)
    expect(redirectTarget(page)).toBe(REGISTER_PATH)

    await fillSignup(page, signupValues())
    await submitSignup(page)
    await expectOnRegistration(page)
    expect((await sessionOf(page))?.role).toBe('STUDENT')
  })

  test('bouncing between sign-in and sign-up never loses the MUN', async ({ page }) => {
    const student = await freshStudent()
    await clickRegisterSignedOut(page)

    for (let hop = 0; hop < 2; hop += 1) {
      await main(page).getByRole('link', { name: 'Create an account' }).click()
      await expect(page).toHaveURL(/\/signup\?redirectTo=/)
      expect(redirectTarget(page)).toBe(REGISTER_PATH)

      await main(page).getByRole('link', { name: 'Sign in', exact: true }).click()
      await expect(page).toHaveURL(/\/login\?redirectTo=/)
      expect(redirectTarget(page)).toBe(REGISTER_PATH)
    }

    // A failed attempt on the way doesn't drop it either.
    await submitLogin(page, student.email, 'not-the-password')
    await expect(main(page).getByRole('alert')).toHaveText('Invalid email or password')
    expect(redirectTarget(page)).toBe(REGISTER_PATH)

    await submitLogin(page, student.email, student.password)
    await expectOnRegistration(page)
  })

  test('a signup validation error keeps the MUN too', async ({ page }) => {
    await page.goto(`/signup?redirectTo=${encodeURIComponent(REGISTER_PATH)}`)
    const v = signupValues({ confirmPassword: 'does-not-match-at-all' })
    await fillSignup(page, v)
    await submitSignup(page)
    await expect(main(page).getByRole('alert')).toHaveText('Passwords do not match.')
    expect(redirectTarget(page)).toBe(REGISTER_PATH)

    await main(page).getByLabel('Confirm password *', { exact: true }).fill(v.password)
    await submitSignup(page)
    await expectOnRegistration(page)
  })

  test('choosing a specific pass signed out keeps that pass through sign-in', async ({ page }) => {
    const student = await freshStudent()
    await page.goto(`/mun/${OPEN.slug}`)
    const select = main(page).getByRole('button', { name: `Select ${OPEN.products[0].name}` })
    const href = await select.getAttribute('href')
    expect(href).toMatch(new RegExp(`^${REGISTER_PATH}\\?product=`))
    await select.click()

    await expect(page).toHaveURL(/\/login\?redirectTo=/)
    expect(redirectTarget(page)).toBe(href)
    await submitLogin(page, student.email, student.password)
    await expect(page).toHaveURL(new RegExp(`${href!.replace('?', '\\?')}$`))
    await expect(pageHeading(page)).toHaveText(OPEN.name)
    await expect(main(page).getByRole('radio', { name: new RegExp(OPEN.products[0].name) })).toBeChecked()
  })

  test('a deep link straight to the registration page also comes back after sign-in', async ({ page }) => {
    const student = await freshStudent()
    await page.goto(REGISTER_PATH)
    await expect(page).toHaveURL(/\/login\?redirectTo=/)
    expect(redirectTarget(page)).toBe(REGISTER_PATH)
    await submitLogin(page, student.email, student.password)
    await expectOnRegistration(page)
  })
})
