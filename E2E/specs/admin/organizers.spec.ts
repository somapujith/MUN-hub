import { expect, test, type Page } from '@playwright/test'
import { TEST_LOGIN_CODE, newApiContext, seedOrganizerLoginCode, signUpViaApi } from '../../fixtures/api'
import { ACCOUNTS } from '../../fixtures/accounts'
import { retireStaffUsers, userRole } from '../../fixtures/fixture-db'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, createOrganizer, createStaffSession, heading, main, tableRow } from './_helpers'

/**
 * Organizer account management. Only ever suspends organizers this test
 * created — never a seeded account.
 */

/** Tries a fresh passwordless sign-in (organizers have no password). */
async function signInStatus(email: string) {
  await seedOrganizerLoginCode(email)
  const api = await newApiContext()
  const response = await api.post('auth/organizers/session', { data: { email, code: TEST_LOGIN_CODE } })
  const body = response.ok() ? null : await response.json()
  await api.dispose()
  return { status: response.status(), message: body?.error?.message as string | undefined }
}

async function searchOrganizer(page: Page, email: string) {
  await page.goto('/admin/organizers')
  await expect(heading(page, 'Organizers')).toBeVisible()
  await main(page).getByRole('searchbox', { name: 'Search' }).fill(email)
  const row = tableRow(page, email)
  await expect(row).toHaveCount(1)
  return row
}

test.describe('admin organizers', () => {
  test('a freshly created organizer is listed and searchable', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const organizer = await createOrganizer()
    const row = await searchOrganizer(page, organizer.email)
    await expect(row).toContainText(organizer.name)
    await expect(row).toContainText('Active')
    await expect(row.getByRole('button', { name: 'Suspend' })).toBeVisible()
    // Search narrows the list to just this account.
    await expect(main(page).getByRole('row')).toHaveCount(2)
    crashes.assertNone()
  })

  test('students never appear in the organizer list', async ({ page }) => {
    await page.goto('/admin/organizers')
    await main(page).getByRole('searchbox', { name: 'Search' }).fill('student@munhub.test')
    await expect(main(page).getByText('No organizers match that search.')).toBeVisible()
  })

  test('suspending blocks sign-in, and reinstating restores it', async ({ page }) => {
    const organizer = await createOrganizer()
    expect((await signInStatus(organizer.email)).status).toBe(200)

    const row = await searchOrganizer(page, organizer.email)
    await row.getByRole('button', { name: 'Suspend' }).click()
    const dialog = page.getByRole('dialog', { name: `Suspend ${organizer.name}` })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Suspend organizer' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('   ')
    await expect(confirm).toBeDisabled()
    const reason = `E2E suspension ${Date.now()}`
    await dialog.getByRole('textbox', { name: 'Reason' }).fill(reason)
    await confirm.click()

    await expect(page.getByText('Organizer suspended')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Suspended')
    await expect(row).toContainText(reason)

    const blocked = await signInStatus(organizer.email)
    expect(blocked.status).toBe(403)
    expect(blocked.message).toBe('Account suspended')
    // Their already-open session is cut off too.
    expect(await (await organizer.api.get('auth/session')).json()).toBeNull()
    expect((await organizer.api.get('organizer/workspace/overview')).status()).toBe(401)

    page.once('dialog', (confirmDialog) => {
      expect(confirmDialog.message()).toContain(`Reinstate ${organizer.name}?`)
      void confirmDialog.accept()
    })
    await row.getByRole('button', { name: 'Reinstate' }).click()
    await expect(page.getByText('Organizer reinstated')).toBeVisible()
    await expect(row).toContainText('Active')
    await expect(row).not.toContainText(reason)

    expect((await signInStatus(organizer.email)).status).toBe(200)
  })

  test('cancelling the suspend dialog or declining reinstatement changes nothing', async ({ page }) => {
    const organizer = await createOrganizer()
    const row = await searchOrganizer(page, organizer.email)
    await row.getByRole('button', { name: 'Suspend' }).click()
    const dialog = page.getByRole('dialog', { name: `Suspend ${organizer.name}` })
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('changed my mind')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Active')
    expect((await signInStatus(organizer.email)).status).toBe(200)

    const admin = await adminApi()
    expect((await admin.post(`admin/organizers/${organizer.userId}/suspend`, { data: { reason: 'api' } })).status()).toBe(204)
    await page.reload()
    await main(page).getByRole('searchbox', { name: 'Search' }).fill(organizer.email)
    await expect(row).toContainText('Suspended')
    page.once('dialog', (confirmDialog) => void confirmDialog.dismiss())
    await row.getByRole('button', { name: 'Reinstate' }).click()
    await expect(row).toContainText('Suspended')
    expect((await signInStatus(organizer.email)).status).toBe(403)

    expect((await admin.post(`admin/organizers/${organizer.userId}/reinstate`)).status()).toBe(204)
  })

  test('the suspend API requires a reason', async () => {
    const organizer = await createOrganizer()
    const admin = await adminApi()
    for (const data of [{}, { reason: '' }]) {
      const response = await admin.post(`admin/organizers/${organizer.userId}/suspend`, { data })
      expect(response.status()).toBe(400)
    }
    expect((await signInStatus(organizer.email)).status).toBe(200)
  })
})

test.describe('organizer suspension only ever touches organizer accounts', () => {
  test('suspending or reinstating a delegate is refused as not found', async () => {
    const student = await signUpViaApi()
    const admin = await adminApi()
    const suspend = await admin.post(`admin/organizers/${student.userId}/suspend`, { data: { reason: 'not an organizer' } })
    expect(suspend.status()).toBe(404)
    expect((await suspend.json()).error.message).toBe('Organizer not found')
    expect((await admin.post(`admin/organizers/${student.userId}/reinstate`)).status()).toBe(404)
    expect(await userRole(student.userId)).toEqual({ role: 'STUDENT', suspended: false })
    // The delegate's session still works.
    expect((await student.api.get('auth/session')).ok()).toBe(true)
    expect(await (await student.api.get('auth/session')).json()).toMatchObject({ userId: student.userId })
    await student.api.dispose()
    await admin.dispose()
  })

  test('staff accounts cannot be suspended through the organizer endpoint', async () => {
    const operations = await createStaffSession('OPERATIONS')
    const target = await createStaffSession('SUPER_ADMIN')
    const admin = await adminApi()
    try {
      const adminSession = (await (await admin.get('auth/session')).json()) as { userId: string; role: string }
      expect(adminSession.role).toBe(ACCOUNTS.admin.role)
      // Before the fix, OPERATIONS could suspend an ADMIN or SUPER_ADMIN this way.
      for (const id of [adminSession.userId, target.userId]) {
        const response = await operations.api.post(`admin/organizers/${id}/suspend`, { data: { reason: 'ops overreach' } })
        expect(response.status()).toBe(404)
        expect((await operations.api.post(`admin/organizers/${id}/reinstate`)).status()).toBe(404)
      }
      expect((await admin.post(`admin/organizers/${target.userId}/suspend`, { data: { reason: 'x' } })).status()).toBe(404)
      expect((await admin.post(`admin/organizers/${operations.userId}/suspend`, { data: { reason: 'x' } })).status()).toBe(404)
      expect(await userRole(adminSession.userId)).toEqual({ role: 'ADMIN', suspended: false })
      expect(await userRole(target.userId)).toEqual({ role: 'SUPER_ADMIN', suspended: false })
      expect(await userRole(operations.userId)).toEqual({ role: 'OPERATIONS', suspended: false })
      // Everyone involved is still signed in.
      expect((await admin.get('admin/overview')).status()).toBe(200)
      expect((await target.api.get('admin/overview')).status()).toBe(200)
    } finally {
      await admin.dispose()
      await operations.api.dispose()
      await target.api.dispose()
      await retireStaffUsers([operations.email, target.email])
    }
  })

  test('operations staff can still suspend and reinstate a real organizer', async () => {
    const operations = await createStaffSession('OPERATIONS')
    const organizer = await createOrganizer()
    try {
      const suspended = await operations.api.post(`admin/organizers/${organizer.userId}/suspend`, {
        data: { reason: 'E2E ops suspension' },
      })
      expect(suspended.status()).toBe(204)
      expect(await userRole(organizer.userId)).toEqual({ role: 'ORGANIZER', suspended: true })
      expect((await signInStatus(organizer.email)).status).toBe(403)
      expect((await operations.api.post(`admin/organizers/${organizer.userId}/reinstate`)).status()).toBe(204)
      expect(await userRole(organizer.userId)).toEqual({ role: 'ORGANIZER', suspended: false })
    } finally {
      await operations.api.dispose()
      await organizer.api.dispose()
      await retireStaffUsers([operations.email])
    }
  })

  test('an unknown id is refused as not found', async () => {
    const admin = await adminApi()
    const id = crypto.randomUUID()
    expect((await admin.post(`admin/organizers/${id}/suspend`, { data: { reason: 'x' } })).status()).toBe(404)
    expect((await admin.post(`admin/organizers/${id}/reinstate`)).status()).toBe(404)
    await admin.dispose()
  })
})
