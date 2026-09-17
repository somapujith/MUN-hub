import { expect, test, type Page } from '@playwright/test'
import { TEST_LOGIN_CODE, newApiContext, seedOrganizerLoginCode } from '../../fixtures/api'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, createOrganizer, heading, main, tableRow } from './_helpers'

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
