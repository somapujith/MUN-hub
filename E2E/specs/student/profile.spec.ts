import { expect, test, type Page } from '@playwright/test'
import { newApiContext } from '../../fixtures/api'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { freshStudentPage, main } from './_helpers'

/** Profile & account settings (PRD §27-29): the saved profile, editing, password, notification preference. */

test.use({ storageState: { cookies: [], origins: [] } })

const field = {
  phone: '#profile-phone',
  institution: '#profile-institution',
  dob: '#profile-dob',
  grade: '#profile-grade',
  address: '#profile-address',
  ecName: '#profile-ec-name',
  ecPhone: '#profile-ec-phone',
  ecRelation: '#profile-ec-relation',
  experience: '#profile-experience',
  referral: '#profile-referral',
}

function toasts(page: Page) {
  return page.getByRole('region', { name: /notifications/i })
}

async function openProfile(page: Page) {
  await page.goto('/profile')
  await expect(pageHeading(page)).toHaveText('Your profile')
  // The form seeds itself once GET /profile resolves.
  await expect(page.locator(field.grade)).toHaveValue(/.+/)
}

async function statusOfLogin(email: string, password: string) {
  const api = await newApiContext()
  const res = await api.post('auth/session', { data: { email, password } })
  const status = res.status()
  await api.dispose()
  return status
}

test.describe('profile — viewing and editing', () => {
  test('the profile page shows the details captured at signup', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    await openProfile(page)

    await expect(page.locator(field.dob)).toHaveValue('2004-06-15')
    await expect(page.locator(field.grade)).toHaveValue('3rd year')
    await expect(page.locator(field.address)).toHaveValue('42 Test Lane, Hyderabad')
    await expect(page.locator(field.ecName)).toHaveValue('E2E Guardian')
    await expect(page.locator(field.ecPhone)).toHaveValue('9876505678')
    await expect(page.locator(field.ecRelation)).toHaveValue('Parent')
    await expect(main(page).getByRole('checkbox', { name: /transportation/i })).not.toBeChecked()
    crashes.assertNone()
    await context.close()
  })

  test('the profile page also shows the saved phone number and institution', async ({ browser }) => {
    test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: /profile never pre-fills phone/institution (profile-page.tsx:74 — GET /profile omits users.phone/institution), so every save forces re-entry')
    const { context, page } = await freshStudentPage(browser)
    await openProfile(page)
    await expect(page.locator(field.phone)).toHaveValue('9876501234')
    await expect(page.locator(field.institution)).toHaveValue('E2E Test University')
    await context.close()
  })

  test('edits are saved with a confirmation and survive a reload', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await openProfile(page)

    // Filled explicitly: the page doesn't pre-fill these two (see the bug above).
    await page.locator(field.phone).fill('9123456780')
    await page.locator(field.institution).fill('E2E Edited Institute')
    await page.locator(field.grade).fill('Final year')
    await page.locator(field.address).fill('7 Edited Road, Secunderabad')
    await page.locator(field.ecRelation).fill('Guardian')
    await main(page).getByRole('checkbox', { name: /transportation/i }).click()
    await page.locator(field.experience).fill('Three conferences')
    await main(page).getByRole('button', { name: 'Save profile' }).click()
    await expect(toasts(page).getByText('Profile saved')).toBeVisible()

    await page.reload()
    await expect(page.locator(field.grade)).toHaveValue('Final year')
    await expect(page.locator(field.address)).toHaveValue('7 Edited Road, Secunderabad')
    await expect(page.locator(field.ecRelation)).toHaveValue('Guardian')
    await expect(page.locator(field.experience)).toHaveValue('Three conferences')
    await expect(main(page).getByRole('checkbox', { name: /transportation/i })).toBeChecked()

    const saved = await (await session.api.get('profile')).json()
    expect(saved).toMatchObject({ gradeOrYear: 'Final year', requiresTransportation: true, munExperience: 'Three conferences' })
    const account = await (await session.api.get('account')).json()
    expect(account.phone).toBe('9123456780')
    await context.close()
  })

  test('a required field cannot be saved empty', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await openProfile(page)
    await page.locator(field.phone).fill('9123456780')
    await page.locator(field.institution).fill('E2E Test University')
    await page.locator(field.ecName).fill('')
    await main(page).getByRole('button', { name: 'Save profile' }).click()

    const valueMissing = await page.locator(field.ecName).evaluate((el) => (el as HTMLInputElement).validity.valueMissing)
    expect(valueMissing).toBe(true)
    await expect(toasts(page).getByText('Profile saved')).toHaveCount(0)

    await page.reload()
    await expect(page.locator(field.ecName)).toHaveValue('E2E Guardian')

    // The server refuses it too, independent of the browser's validation.
    const res = await session.api.put('profile', {
      data: {
        phone: '9123456780',
        institution: 'E2E Test University',
        dateOfBirth: '2004-06-15',
        gradeOrYear: '3rd year',
        residentialAddress: '42 Test Lane, Hyderabad',
        requiresTransportation: false,
        emergencyContactName: '',
        emergencyContactPhone: '9876505678',
        emergencyContactRelation: 'Parent',
      },
    })
    expect(res.status()).toBe(400)
    await context.close()
  })

  test('the profile page requires sign-in', async ({ page }) => {
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprofile/)
  })
})

test.describe('profile — account & security', () => {
  test('changing the password needs the current one, then only the new one signs in', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await openProfile(page)
    const security = main(page).getByRole('region', { name: 'Account & security' })
    const newPassword = 'e2e-rotated-password'

    await security.getByLabel('Current password').fill('not-my-password')
    await security.getByLabel('New password', { exact: true }).fill(newPassword)
    await security.getByLabel('Confirm new password').fill(newPassword)
    await security.getByRole('button', { name: 'Change password' }).click()
    await expect(toasts(page).getByText('Current password is incorrect')).toBeVisible()

    await security.getByLabel('Current password').fill(session.password)
    await security.getByRole('button', { name: 'Change password' }).click()
    await expect(toasts(page).getByText('Password changed')).toBeVisible()
    await expect(security.getByLabel('Current password')).toHaveValue('')

    expect(await statusOfLogin(session.email, newPassword)).toBe(200)
    expect(await statusOfLogin(session.email, session.password)).toBe(401)
    await context.close()
  })

  test('mismatched new passwords are caught by the form, and the server refuses short ones', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await openProfile(page)
    const security = main(page).getByRole('region', { name: 'Account & security' })

    await security.getByLabel('Current password').fill(session.password)
    await security.getByLabel('New password', { exact: true }).fill('e2e-one-password')
    await security.getByLabel('Confirm new password').fill('e2e-other-password')
    await security.getByRole('button', { name: 'Change password' }).click()
    await expect(toasts(page).getByText('New passwords do not match.')).toBeVisible()

    expect(await statusOfLogin(session.email, session.password)).toBe(200)

    const tooShort = await session.api.post('auth/session/password', {
      data: { currentPassword: session.password, newPassword: 'short' },
    })
    expect(tooShort.status()).toBe(400)
    await context.close()
  })

  test('the email-notification preference toggles and persists', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await openProfile(page)
    const checkbox = main(page).getByRole('checkbox', { name: 'Send me email notifications' })
    const save = main(page).getByRole('button', { name: 'Save preference' })

    await expect(checkbox).toBeChecked()
    await expect(save).toBeDisabled()
    await checkbox.click()
    await expect(checkbox).not.toBeChecked()
    await save.click()
    await expect(toasts(page).getByText('Preference saved')).toBeVisible()

    await page.reload()
    await expect(checkbox).not.toBeChecked()
    expect((await (await session.api.get('account')).json()).emailNotificationsEnabled).toBe(false)

    await checkbox.click()
    await save.click()
    await expect(toasts(page).getByText('Preference saved').first()).toBeVisible()
    await expect.poll(async () => (await (await session.api.get('account')).json()).emailNotificationsEnabled).toBe(true)
    await context.close()
  })
})

test.describe('profile — PRD sections not built yet', () => {
  test('previous MUN achievements can be recorded (PRD §13, §27-28)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §27-28 "Previous Achievements" profile section')
    const { context, page } = await freshStudentPage(browser)
    await openProfile(page)
    await expect(main(page).getByText(/previous achievements/i)).toBeVisible()
    await context.close()
  })

  test('academic details beyond institution and year are editable (PRD §11, §27)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §11/§27 academic details section (course, class/section, etc.)')
    const { context, page } = await freshStudentPage(browser)
    await openProfile(page)
    await expect(main(page).getByText(/academic details/i)).toBeVisible()
    await context.close()
  })

  test('profile preferences are editable (PRD §14)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §14 profile preferences (committee/city preferences, visibility)')
    const { context, page } = await freshStudentPage(browser)
    await openProfile(page)
    await expect(main(page).getByText(/profile preferences/i)).toBeVisible()
    await context.close()
  })

  test('consent history is visible (PRD §15)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §15 consent history on the account page')
    const { context, page } = await freshStudentPage(browser)
    await openProfile(page)
    await expect(main(page).getByText(/consent/i)).toBeVisible()
    await context.close()
  })

  test('a profile-completion percentage is shown (PRD §29)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §29 profile-completion meter')
    const { context, page } = await freshStudentPage(browser)
    await openProfile(page)
    await expect(main(page).getByText(/profile completion/i)).toBeVisible()
    await expect(main(page).getByText(/\d+%/)).toBeVisible()
    await context.close()
  })
})
