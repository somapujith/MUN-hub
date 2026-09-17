import { expect, test, type Page } from '@playwright/test'
import { newApiContext } from '../../fixtures/api'
import { ACCOUNTS } from '../../fixtures/accounts'
import { ADULT_DOB, minorDob, signUpPayload } from '../../fixtures/data'
import { OPEN } from '../../fixtures/fixture-muns'
import { expectSignedInHeader, pageHeading, watchForCrashes } from '../../fixtures/ui'
import { consentBox, fillSignup, sessionOf, signupField as field, signupValues, submitSignup, type SignupValues } from './_helpers'

/**
 * Delegate signup (PRD §7-16, §34-35).
 *
 * Consent is asserted by checkbox label only; the policy links inside those
 * labels belong to unshipped work.
 */

const SECTIONS = [
  '1. Account details',
  '2. Personal details',
  '3. Contact details',
  '4. Academic details',
  '5. Parent / emergency contact',
  '6. Previous MUN experience & achievements',
  '7. Profile preferences',
  '8. Consent',
] as const

const REQUIRED_LABELS = [
  'Full name *',
  'Email address *',
  'Password *',
  'Confirm password *',
  'Date of birth *',
  'Gender *',
  'Primary mobile number *',
  'Residential address *',
  'School / college / university *',
  'Year of study *',
  'Parent / guardian name *',
  'Contact number *',
  'Relationship *',
] as const

const OPTIONAL_LABELS = [
  'Preferred name',
  'Nationality',
  'Alternate mobile number',
  'City',
  'Course / program',
  'Student ID',
  'Alternate emergency contact name',
  'Previous MUN experience',
  'Short bio',
  'Referral code',
] as const

function main(page: Page) {
  return page.getByRole('main')
}

function section(page: Page, title: string) {
  return main(page).locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) })
}

const values = signupValues
const submit = submitSignup

async function expectFieldsKept(page: Page, v: SignupValues) {
  await expect(field(page, 'Full name *')).toHaveValue(v.name)
  await expect(field(page, 'Email address *')).toHaveValue(v.email)
  await expect(field(page, 'Date of birth *')).toHaveValue(v.dob)
  await expect(field(page, 'Gender *')).toHaveValue(v.gender)
  await expect(field(page, 'Primary mobile number *')).toHaveValue(v.phone)
  await expect(field(page, 'Residential address *')).toHaveValue(v.address)
  await expect(field(page, 'School / college / university *')).toHaveValue(v.institution)
  await expect(field(page, 'Year of study *')).toHaveValue(v.year)
  await expect(field(page, 'Parent / guardian name *')).toHaveValue(v.ecName)
  await expect(field(page, 'Contact number *')).toHaveValue(v.ecPhone)
  await expect(field(page, 'Relationship *')).toHaveValue(v.ecRelation)
}

test.describe('signup form structure', () => {
  test('all eight sections are present, in order, each in its own card', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/signup')
    await expect(pageHeading(page)).toHaveText('Create your account')

    const titles = main(page).getByText(/^\d\. /)
    await expect(titles).toHaveText([...SECTIONS])
    for (const title of SECTIONS) await expect(section(page, title)).toHaveCount(1)

    // A field belongs to its own section and no other.
    await expect(section(page, SECTIONS[0]).getByLabel('Full name *', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[1]).getByLabel('Date of birth *', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[2]).getByLabel('Primary mobile number *', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[3]).getByLabel('School / college / university *', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[4]).getByLabel('Parent / guardian name *', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[5]).getByLabel('Previous MUN experience', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[6]).getByLabel('Short bio', { exact: true })).toBeVisible()
    await expect(section(page, SECTIONS[7]).getByRole('checkbox', { name: /terms of service/i })).toBeVisible()
    await expect(section(page, SECTIONS[0]).getByLabel('Date of birth *', { exact: true })).toHaveCount(0)
    crashes.assertNone()
  })

  test('required fields are marked with an asterisk and optional ones are not', async ({ page }) => {
    await page.goto('/signup')
    for (const label of REQUIRED_LABELS) await expect(field(page, label)).toBeVisible()
    for (const label of OPTIONAL_LABELS) {
      await expect(field(page, label)).toBeVisible()
      await expect(field(page, `${label} *`)).toHaveCount(0)
    }
    await expect(consentBox(page, /terms of service.*\*/i)).toBeVisible()
    await expect(consentBox(page, /privacy policy.*\*/i)).toBeVisible()
    // Password fields are masked.
    await expect(field(page, 'Password *')).toHaveAttribute('type', 'password')
    await expect(field(page, 'Confirm password *')).toHaveAttribute('type', 'password')
  })

  test('consent boxes start unchecked, and public profile visibility is off by default', async ({ page }) => {
    await page.goto('/signup')
    await expect(consentBox(page, /terms of service/i)).not.toBeChecked()
    await expect(consentBox(page, /privacy policy/i)).not.toBeChecked()
    await expect(main(page).getByRole('checkbox', { name: 'Make my profile publicly visible' })).not.toBeChecked()
  })

  test('"number of MUNs attended" only appears once prior experience is ticked', async ({ page }) => {
    await page.goto('/signup')
    await expect(field(page, 'Number of MUNs attended')).toHaveCount(0)
    await main(page).getByRole('checkbox', { name: 'I have attended an MUN before' }).check()
    await expect(field(page, 'Number of MUNs attended')).toBeVisible()
  })

  test('"Sign in" links to login', async ({ page }) => {
    await page.goto('/signup')
    await expect(main(page).getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login')
  })
})

test.describe('guardian acknowledgement', () => {
  const guardianLabel = /parent\/guardian acknowledges/i

  test('a date of birth under 18 reveals it; an adult date of birth hides it', async ({ page }) => {
    await page.goto('/signup')
    const guardian = main(page).getByRole('checkbox', { name: guardianLabel })
    await expect(guardian).toHaveCount(0)

    await field(page, 'Date of birth *').fill(minorDob())
    await expect(guardian).toBeVisible()
    await expect(guardian).not.toBeChecked()

    await field(page, 'Date of birth *').fill(ADULT_DOB)
    await expect(guardian).toHaveCount(0)
  })

  test('a minor can sign up with the acknowledgement ticked', async ({ page }) => {
    const v = values({ dob: minorDob() })
    await page.goto('/signup')
    await fillSignup(page, v)
    await main(page).getByRole('checkbox', { name: guardianLabel }).check()
    await submit(page)
    await expect(page).toHaveURL(/\/profile$/)
    expect((await sessionOf(page))?.role).toBe('STUDENT')
  })
})

test.describe('signup validation', () => {
  test('mismatched passwords are refused and nothing typed is lost', async ({ page }) => {
    const v = values({ confirmPassword: 'a-different-password' })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toHaveText('Passwords do not match.')
    await expect(page).toHaveURL(/\/signup$/)
    await expectFieldsKept(page, v)
    await expect(consentBox(page, /terms of service/i)).toBeChecked()
    expect(await sessionOf(page)).toBeNull()

    // Fixing only the offending field is enough.
    await field(page, 'Confirm password *').fill(v.password)
    await submit(page)
    await expect(page).toHaveURL(/\/profile$/)
  })

  test('a password shorter than 8 characters is refused', async ({ page }) => {
    const v = values({ password: 'short7!', confirmPassword: 'short7!' })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toHaveText('Password must be at least 8 characters.')
    await expect(page).toHaveURL(/\/signup$/)
    await expectFieldsKept(page, v)
  })

  test('submitting without the Terms and Privacy consent is refused', async ({ page }) => {
    const v = values({ consent: false })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toContainText(
      'You must accept the Terms of Service and Privacy Policy to create an account.',
    )
    await expect(page).toHaveURL(/\/signup$/)

    // Only one of the two is still not enough.
    await consentBox(page, /terms of service/i).check()
    await submit(page)
    await expect(main(page).getByRole('alert')).toContainText('You must accept the Terms of Service and Privacy Policy')
    await expectFieldsKept(page, v)
    expect(await sessionOf(page)).toBeNull()
  })

  test('the API refuses a signup without consent too', async () => {
    const api = await newApiContext()
    for (const override of [{ acceptedTermsOfService: false }, { acceptedPrivacyPolicy: false }]) {
      const payload = signUpPayload(override)
      const res = await api.post('auth/users', { data: payload })
      expect(res.status()).toBeGreaterThanOrEqual(400)
      // No account was created behind the refusal.
      const login = await api.post('auth/session', { data: { email: payload.email, password: payload.password } })
      expect(login.status()).toBe(401)
    }
    await api.dispose()
  })

  test('the API answers a signup without consent with a 4xx, not a server error', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: lib/actions/auth.ts signUp throws "You must accept the Terms of Service/Privacy Policy…", which server/middleware/error.ts does not map, so the API returns 500 INTERNAL',
    )
    const api = await newApiContext()
    for (const override of [{ acceptedTermsOfService: false }, { acceptedPrivacyPolicy: false }]) {
      const res = await api.post('auth/users', { data: signUpPayload(override) })
      expect(res.status()).toBeGreaterThanOrEqual(400)
      expect(res.status()).toBeLessThan(500)
    }
    await api.dispose()
  })

  test('a missing required field is refused without clearing the form', async ({ page }) => {
    const v = values({ gender: '' })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/signup$/)
    await expectFieldsKept(page, v)
    await expect(field(page, 'Password *')).toHaveValue(v.password)
    expect(await sessionOf(page)).toBeNull()
  })

  test('the error for a missing required field names the field', async ({ page }) => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: signup-page.tsx shows the API\'s generic "Validation failed" and ignores error.fields, so the delegate is not told which field is missing',
    )
    const v = values({ gender: '' })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toContainText(/gender/i, { timeout: 5_000 })
  })

  test('an existing email shows the duplicate-account message', async ({ page }) => {
    const v = values({ email: ACCOUNTS.student.email })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toContainText('An account with that email already exists')
    await expect(page).toHaveURL(/\/signup$/)
    await expectFieldsKept(page, v)
    expect(await sessionOf(page)).toBeNull()
  })

  test('the duplicate-account message offers Sign In and Forgot Password (PRD §35)', async ({ page }) => {
    test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: the duplicate-email error on /signup offers no "Forgot password" action next to it (PRD §35)')
    await page.goto('/signup')
    await fillSignup(page, values({ email: ACCOUNTS.student.email }))
    await submit(page)
    await expect(main(page).getByRole('alert')).toContainText('An account with that email already exists')
    await expect(main(page).getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(main(page).getByRole('link', { name: /forgot password/i })).toBeVisible({ timeout: 5_000 })
  })

  test('the duplicate check ignores email case', async ({ page }) => {
    const v = values({ email: ACCOUNTS.student.email.toUpperCase() })
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(main(page).getByRole('alert')).toContainText('An account with that email already exists')
  })
})

test.describe('successful signup', () => {
  test('creates a delegate account, signs it in and lands on the profile', async ({ page }) => {
    const v = values()
    await page.goto('/signup')
    await fillSignup(page, v)
    await field(page, 'Preferred name').fill('Sig')
    await submit(page)

    await expect(page).toHaveURL(/\/profile$/)
    await expectSignedInHeader(page, 'Delegate')
    expect((await sessionOf(page))?.role).toBe('STUDENT')
    // The profile shows what was just captured.
    await expect(pageHeading(page)).toHaveText('Your profile')
    await expect(main(page).getByRole('textbox', { name: 'Date of birth' })).toHaveValue(v.dob)
    await expect(main(page).getByRole('textbox', { name: 'Grade / year' })).toHaveValue(v.year)
    await expect(main(page).getByRole('textbox', { name: 'Residential address' })).toHaveValue(v.address)
  })

  test('the profile page shows the phone and institution captured at signup (PRD §34)', async ({ page }) => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: profile-page.tsx never pre-fills phone/institution (they live on users and GET /profile omits them), so /profile shows them blank after signup',
    )
    const v = values()
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(page).toHaveURL(/\/profile$/)
    await expect(main(page).getByRole('textbox', { name: 'Grade / year' })).toHaveValue(v.year)
    await expect(main(page).getByRole('textbox', { name: 'Phone number' })).toHaveValue(v.phone, { timeout: 5_000 })
    await expect(main(page).getByRole('textbox', { name: 'School or institution' })).toHaveValue(v.institution)
  })

  test('the new password works for a later sign-in', async ({ page, browser }) => {
    const v = values()
    await page.goto('/signup')
    await fillSignup(page, v)
    await submit(page)
    await expect(page).toHaveURL(/\/profile$/)

    const fresh = await browser.newContext()
    const other = await fresh.newPage()
    await other.goto('/login')
    await other.locator('#email').fill(v.email)
    await other.locator('#password').fill(v.password)
    await other.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(other).toHaveURL(/\/dashboard$/)
    await fresh.close()
  })

  test('with ?redirectTo= the new account lands on that MUN’s registration (PRD §17)', async ({ page }) => {
    await page.goto(`/signup?redirectTo=${encodeURIComponent(`/register/${OPEN.slug}`)}`)
    await expect(main(page).getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
      'href',
      `/login?redirectTo=${encodeURIComponent(`/register/${OPEN.slug}`)}`,
    )
    await fillSignup(page, values())
    await submit(page)
    await expect(page).toHaveURL(new RegExp(`/register/${OPEN.slug}$`))
    await expect(pageHeading(page)).toHaveText(OPEN.name)
    await expect(main(page).getByRole('heading', { name: 'Choose your registration' })).toBeVisible()
  })

  test('an off-site ?redirectTo= is ignored after signup', async ({ page }) => {
    await page.goto(`/signup?redirectTo=${encodeURIComponent('//evil.example')}`)
    await fillSignup(page, values())
    await submit(page)
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/profile$/)
  })
})
