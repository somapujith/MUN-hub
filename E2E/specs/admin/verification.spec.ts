import { expect, test, type Page } from '@playwright/test'
import { newApiContext, signUpOrganizerViaApi, signUpViaApi } from '../../fixtures/api'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, createApplication, findRowAcrossPages, heading, main, tableRow, type FreshApplication } from './_helpers'

/**
 * Gate 2 — module-level content verification (/admin/verification,
 * reviewModule). Each test approves its own fresh application, then its
 * organizer confirms one module so it lands in PENDING_REVIEW.
 */

const MODULE_LABELS = { BASIC_INFO: 'Basic Info', DATES_VENUE: 'Dates & Venue', CONTACT: 'Contact' } as const
type TrackedModule = keyof typeof MODULE_LABELS

async function moduleInReview(module: TrackedModule): Promise<FreshApplication> {
  const app = await createApplication('E2E Admin Verify')
  const admin = await adminApi()
  const approve = await admin.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })
  expect(approve.ok()).toBeTruthy()
  const confirm = await app.organizer.api.post(`muns/${app.munId}/modules/${module}/actions/confirm`)
  expect(confirm.status(), await confirm.text()).toBe(200)
  expect((await confirm.json()).state).toBe('PENDING_REVIEW')
  return app
}

async function moduleState(munId: string, module: TrackedModule): Promise<string> {
  const api = await adminApi()
  const response = await api.get(`muns/${munId}/modules/${module}`)
  expect(response.ok()).toBeTruthy()
  const { state } = (await response.json()) as { state: string }
  await api.dispose()
  return state
}

async function openModuleReview(page: Page, app: FreshApplication, module: TrackedModule) {
  await page.goto('/admin/verification')
  await expect(heading(page, 'Verification')).toBeVisible()
  const row = await findRowAcrossPages(page, app.munName)
  await expect(row).toContainText(MODULE_LABELS[module])
  await row.getByRole('button', { name: 'Review module' }).click()
  const dialog = page.getByRole('dialog', { name: `${MODULE_LABELS[module]} — ${app.munName}` })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Gate 2 — verification console', () => {
  test('renders the module review queue', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/admin/verification')
    await expect(heading(page, 'Verification')).toBeVisible()
    await expect(main(page)).toContainText(/Gate 2/)
    const table = main(page).getByRole('table')
    await expect(table.or(main(page).getByText('No modules pending review.'))).toBeVisible()
    if (await table.isVisible()) {
      for (const column of ['MUN', 'Module', 'Confirmed', 'Actions']) {
        await expect(table.getByRole('columnheader', { name: column })).toBeVisible()
      }
    }
    crashes.assertNone()
  })

  test('an admin verifies a confirmed module and it leaves the pending list', async ({ page }) => {
    const app = await moduleInReview('BASIC_INFO')
    const dialog = await openModuleReview(page, app, 'BASIC_INFO')

    await expect(dialog.getByRole('combobox', { name: 'Decision' })).toHaveValue('VERIFIED')
    await expect(dialog).toContainText('No issues added.')
    await dialog.getByRole('button', { name: 'Verify', exact: true }).click()

    await expect(page.getByText('Module verified')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(tableRow(page, app.munName)).toHaveCount(0)
    expect(await moduleState(app.munId, 'BASIC_INFO')).toBe('VERIFIED')
  })

  test('requesting changes needs at least one issue, and records it', async ({ page }) => {
    const app = await moduleInReview('DATES_VENUE')
    const dialog = await openModuleReview(page, app, 'DATES_VENUE')

    await dialog.getByRole('combobox', { name: 'Decision' }).selectOption({ label: 'Request changes' })
    const submit = dialog.getByRole('button', { name: 'Request changes', exact: true })
    await expect(dialog).toContainText('(at least one required)')
    await expect(submit).toBeDisabled()

    await dialog.getByRole('button', { name: 'Add issue' }).click()
    await expect(submit).toBeDisabled() // an issue with no reason doesn't count
    await dialog.getByRole('combobox', { name: 'Severity for issue 1' }).selectOption('HIGH')
    await dialog.getByRole('textbox', { name: 'Reason for issue 1' }).fill('Venue address is incomplete.')
    await dialog.getByRole('textbox', { name: 'Previous value for issue 1' }).fill('Hyderabad')
    await dialog.getByRole('textbox', { name: 'Expected value for issue 1' }).fill('Full street address')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByText('Changes requested from organizer')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(tableRow(page, app.munName)).toHaveCount(0)
    expect(await moduleState(app.munId, 'DATES_VENUE')).toBe('CHANGES_REQUESTED')

    // The organizer can now fix and re-confirm the module.
    const reconfirm = await app.organizer.api.post(`muns/${app.munId}/modules/DATES_VENUE/actions/confirm`)
    expect(reconfirm.status()).toBe(200)
    expect(await moduleState(app.munId, 'DATES_VENUE')).toBe('PENDING_REVIEW')
  })

  test('a removed issue no longer counts toward the requirement', async ({ page }) => {
    const app = await moduleInReview('CONTACT')
    const dialog = await openModuleReview(page, app, 'CONTACT')
    await dialog.getByRole('combobox', { name: 'Decision' }).selectOption({ label: 'Reject' })
    await dialog.getByRole('button', { name: 'Add issue' }).click()
    await dialog.getByRole('textbox', { name: 'Reason for issue 1' }).fill('Contact is fake')
    await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Remove issue 1' }).click()
    await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await moduleState(app.munId, 'CONTACT')).toBe('PENDING_REVIEW')
  })

  test('a module that was already reviewed cannot be reviewed again', async () => {
    const app = await moduleInReview('BASIC_INFO')
    const admin = await adminApi()
    const url = `muns/${app.munId}/modules/BASIC_INFO/actions/review`
    const first = await admin.post(url, { data: { decision: 'VERIFIED', issues: [] } })
    expect(first.status()).toBe(200)
    const second = await admin.post(url, {
      data: { decision: 'REJECTED', issues: [{ severity: 'BLOCKER', reason: 'late second opinion' }] },
    })
    expect(second.ok()).toBe(false)
    expect(await moduleState(app.munId, 'BASIC_INFO')).toBe('VERIFIED')
  })

  test('a stale second review is reported as a conflict the reviewer can read', async () => {
    const app = await moduleInReview('BASIC_INFO')
    const admin = await adminApi()
    const url = `muns/${app.munId}/modules/BASIC_INFO/actions/review`
    await admin.post(url, { data: { decision: 'VERIFIED', issues: [] } })
    const second = await admin.post(url, { data: { decision: 'VERIFIED', issues: [] } })
    expect(second.status()).toBe(409)
    expect((await second.json()).error.message).toMatch(/already reviewed/i)
  })

  test('the organizer cannot review their own module', async () => {
    const app = await moduleInReview('BASIC_INFO')
    const response = await app.organizer.api.post(`muns/${app.munId}/modules/BASIC_INFO/actions/review`, {
      data: { decision: 'VERIFIED', issues: [] },
    })
    expect(response.status()).toBe(403)
    expect(await moduleState(app.munId, 'BASIC_INFO')).toBe('PENDING_REVIEW')
  })

  test('a module’s review state is visible only to its organizer and staff', async () => {
    const app = await moduleInReview('BASIC_INFO')
    const path = `muns/${app.munId}/modules/BASIC_INFO`

    expect((await app.organizer.api.get(path)).status()).toBe(200)
    expect(await moduleState(app.munId, 'BASIC_INFO')).toBe('PENDING_REVIEW')

    const otherOrganizer = await signUpOrganizerViaApi()
    expect((await otherOrganizer.api.get(path)).status()).toBe(403)
    const delegate = await signUpViaApi()
    expect((await delegate.api.get(path)).status()).toBe(403)
    const anon = await newApiContext()
    expect((await anon.get(path)).status()).toBe(401)
    // An anonymous read of a module never touched before must not create its row either.
    expect((await anon.get(`muns/${app.munId}/modules/CONTACT`)).status()).toBe(401)
    await anon.dispose()
  })
})
