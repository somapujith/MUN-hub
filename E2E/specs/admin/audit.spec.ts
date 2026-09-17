import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, createApplication, createOrganizer, heading, main } from './_helpers'

/** Audit log list + per-target detail, for actions this test performs itself. */

function auditEntry(page: Page, targetType: string, targetId: string) {
  return main(page).getByRole('listitem').filter({ hasText: `${targetType}/${targetId}` })
}

test.describe('admin audit log', () => {
  test('an organizer suspension is listed and its detail page shows the full history', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const organizer = await createOrganizer()
    const admin = await adminApi()
    const reason = `E2E audit suspension ${Date.now()}`
    expect((await admin.post(`admin/organizers/${organizer.userId}/suspend`, { data: { reason } })).status()).toBe(204)
    expect((await admin.post(`admin/organizers/${organizer.userId}/reinstate`)).status()).toBe(204)

    await page.goto('/admin/audit')
    await expect(heading(page, 'Audit log')).toBeVisible()
    await expect(main(page).getByText(/^Page 1 of \d+$/)).toBeVisible()
    const entries = auditEntry(page, 'user', organizer.userId)
    await expect(entries).toHaveCount(2)
    const suspended = entries.filter({ has: page.getByRole('link', { name: 'ORGANIZER_SUSPENDED' }) })
    await expect(suspended).toContainText(reason)
    await expect(suspended).toContainText(/Admin/i)
    await expect(entries.filter({ has: page.getByRole('link', { name: 'ORGANIZER_REINSTATED' }) })).toHaveCount(1)

    await suspended.getByRole('link', { name: 'ORGANIZER_SUSPENDED' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/audit/user/${organizer.userId}$`))
    await expect(heading(page, 'Audit detail')).toBeVisible()
    await expect(main(page)).toContainText(`Full history for user/${organizer.userId}, oldest first.`)
    const history = main(page).getByRole('list').getByRole('listitem')
    await expect(history).toHaveCount(2)
    await expect(history.nth(0)).toContainText('ORGANIZER_SUSPENDED')
    await expect(history.nth(0)).toContainText(reason)
    await expect(history.nth(0)).toContainText(/actor \S+/)
    await expect(history.nth(1)).toContainText('ORGANIZER_REINSTATED')
    crashes.assertNone()
  })

  test('a MUN\'s detail page shows its Gate 1 lifecycle, including the decision note', async ({ page }) => {
    const app = await createApplication('E2E Admin Audit')
    const admin = await adminApi()
    const note = 'Changes needed: add venue confirmation.'
    const decision = await admin.post(`admin/muns/${app.munId}/review-application`, {
      data: { decision: 'CHANGES_REQUESTED', notes: note },
    })
    expect(decision.ok()).toBeTruthy()

    await page.goto(`/admin/audit/mun/${app.munId}`)
    await expect(heading(page, 'Audit detail')).toBeVisible()
    const history = main(page).getByRole('list').getByRole('listitem')
    await expect(history).toHaveCount(3)
    await expect(history.nth(0)).toContainText('SUBMITTED')
    await expect(history.nth(0)).toContainText(`actor ${app.organizer.userId}`)
    await expect(history.nth(1)).toContainText('UNDER_REVIEW')
    await expect(history.nth(2)).toContainText('CHANGES_REQUESTED')
    await expect(history.nth(2)).toContainText(note)
  })

  test('an application decision shows up in the platform audit log', async ({ page }) => {
    const app = await createApplication('E2E Admin Audit')
    const admin = await adminApi()
    const reason = `E2E audit rejection ${Date.now()}`
    expect((await admin.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'REJECTED', notes: reason } })).ok()).toBeTruthy()
    await page.goto('/admin/audit')
    await expect(heading(page, 'Audit log')).toBeVisible()
    const entry = auditEntry(page, 'mun', app.munId)
    await expect(entry).toHaveCount(1, { timeout: 5_000 })
    await expect(entry.getByRole('link', { name: 'APPLICATION_REJECTED' })).toBeVisible()
    await expect(entry).toContainText(reason)
  })

  test('an approval is listed once, not once per lifecycle step', async ({ page }) => {
    const app = await createApplication('E2E Admin Audit')
    const admin = await adminApi()
    expect((await admin.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })).ok()).toBeTruthy()
    await page.goto('/admin/audit')
    const entry = auditEntry(page, 'mun', app.munId)
    await expect(entry).toHaveCount(1, { timeout: 5_000 })
    await expect(entry.getByRole('link', { name: 'APPLICATION_APPROVED' })).toBeVisible()

    await page.goto(`/admin/audit/mun/${app.munId}`)
    const history = main(page).getByRole('list').getByRole('listitem')
    await expect(history).toHaveCount(4)
    for (const [index, action] of ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ONBOARDING'].entries()) {
      await expect(history.nth(index)).toContainText(action)
    }
  })

  test('a target with no history shows the empty state', async ({ page }) => {
    await page.goto(`/admin/audit/user/${randomUUID()}`)
    await expect(heading(page, 'Audit detail')).toBeVisible()
    await expect(main(page).getByText('No recorded actions for this target.')).toBeVisible()
  })
})
