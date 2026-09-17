import { expect, test, type Locator, type Page } from '@playwright/test'
import { watchForCrashes } from '../../fixtures/ui'
import {
  adminApi,
  createApplication,
  findRowAcrossPages,
  heading,
  organizerMunStatus,
  tableRow,
  type FreshApplication,
} from './_helpers'

/**
 * Gate 1 — organizer APPLICATION approval (/admin/review, reviewMunApplication).
 * Every decision acts on an application this test just created, never on
 * seeded or junk rows.
 */

interface MunReview {
  status: string
  organizerApplication: { status: string } | null
  verificationLogs: Array<{ action: string; notes: string | null; internalNotes: string | null }>
}

async function munReview(munId: string): Promise<MunReview> {
  const api = await adminApi()
  const response = await api.get(`admin/muns/${munId}/review`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as MunReview
}

async function openReviewDialog(page: Page, app: FreshApplication, checkRow?: (row: Locator) => Promise<void>) {
  await page.goto('/admin/review')
  await expect(heading(page, 'Applications')).toBeVisible()
  const row = await findRowAcrossPages(page, app.munName)
  // The open dialog hides the page behind it from the accessibility tree.
  if (checkRow) await checkRow(row)
  await row.getByRole('button', { name: 'Review' }).click()
  const dialog = page.getByRole('dialog', { name: `Review ${app.munName}` })
  await expect(dialog).toBeVisible()
  return dialog
}

async function decide(page: Page, app: FreshApplication, decision: string, notes?: string, internal?: string) {
  const dialog = await openReviewDialog(page, app)
  await dialog.getByRole('combobox', { name: 'Decision' }).selectOption({ label: decision })
  if (notes) await dialog.getByRole('textbox', { name: 'Notes to organizer' }).fill(notes)
  if (internal) await dialog.getByRole('textbox', { name: 'Internal notes (ops only)' }).fill(internal)
  await dialog.getByRole('button', { name: decision }).click()
  return dialog
}

test.describe('Gate 1 — applications queue', () => {
  test('a freshly submitted application is listed and its Review dialog shows the details', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const app = await createApplication()

    const dialog = await openReviewDialog(page, app, async (row) => {
      await expect(row).toContainText('Hyderabad')
      await expect(row).toContainText('Submitted')
    })

    await expect(dialog).toContainText(/Gate 1 decision/)
    await expect(dialog).toContainText(/Application submitted:\s*\w{3} \d{1,2}, \d{4}/)
    await expect(dialog.getByRole('listitem').filter({ hasText: 'SUBMITTED' })).toBeVisible()
    const decision = dialog.getByRole('combobox', { name: 'Decision' })
    await expect(decision).toHaveValue('APPROVED')
    for (const label of ['Approve', 'Request changes', 'Reject']) {
      await expect(decision.getByRole('option', { name: label })).toHaveCount(1)
    }

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect((await munReview(app.munId)).status).toBe('SUBMITTED')
    crashes.assertNone()
  })

  test('APPROVE takes the application out of the pending queue', async ({ page }) => {
    const app = await createApplication()
    const dialog = await decide(page, app, 'Approve', 'Welcome aboard', 'E2E internal approve note')

    await expect(page.getByText('Application approved')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(tableRow(page, app.munName)).toHaveCount(0)

    const review = await munReview(app.munId)
    expect(review.status).toBe('APPROVED')
    const approvedLog = review.verificationLogs.find((log) => log.action === 'APPROVED')
    expect(approvedLog?.notes).toBe('Welcome aboard')
    expect(approvedLog?.internalNotes).toBe('E2E internal approve note')
    // The organizer is no longer "waiting on review".
    expect(await organizerMunStatus(app.organizer, app.munId)).not.toMatch(/^(SUBMITTED|UNDER_REVIEW)$/)
  })

  test('an approved organizer\'s MUN moves on to ONBOARDING', async ({ page }) => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: reviewMunApplication stops at APPROVED — nothing performs the APPROVED -> ONBOARDING Gate-1 exit, so the organizer can never submit content (setup page only allows ONBOARDING/ACTION_REQUIRED/READY_FOR_SUBMISSION/CONTENT_SUBMITTED)',
    )
    const app = await createApplication()
    await decide(page, app, 'Approve')
    await expect(page.getByText('Application approved')).toBeVisible()
    await expect.poll(() => organizerMunStatus(app.organizer, app.munId), { timeout: 5_000 }).toBe('ONBOARDING')
  })

  test('approving marks the organizer application record itself as APPROVED', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: organizer_applications.status is never updated by reviewMunApplication (stays SUBMITTED), so the BASIC_INFO validator\'s "organizer approved" check can never pass',
    )
    const app = await createApplication()
    const api = await adminApi()
    const response = await api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })
    expect(response.ok()).toBeTruthy()
    expect((await munReview(app.munId)).organizerApplication?.status).toBe('APPROVED')
  })

  test('REQUEST CHANGES records the note for the organizer', async ({ page }) => {
    const app = await createApplication()
    const note = 'Please add your previous editions and a website link.'
    await decide(page, app, 'Request changes', note)

    await expect(page.getByText('Changes requested from organizer')).toBeVisible()
    await expect(tableRow(page, app.munName)).toHaveCount(0)

    const review = await munReview(app.munId)
    expect(review.status).toBe('CHANGES_REQUESTED')
    expect(review.verificationLogs.find((log) => log.action === 'CHANGES_REQUESTED')?.notes).toBe(note)
    expect(await organizerMunStatus(app.organizer, app.munId)).toBe('CHANGES_REQUESTED')
  })

  test('REJECT with a reason rejects the application', async ({ page }) => {
    const app = await createApplication()
    const reason = 'Organizing body could not be verified.'
    const dialog = await openReviewDialog(page, app)
    await dialog.getByRole('combobox', { name: 'Decision' }).selectOption({ label: 'Reject' })
    await expect(dialog.getByRole('textbox', { name: 'Notes to organizer' })).toHaveAttribute(
      'placeholder',
      /why this was rejected/i,
    )
    await dialog.getByRole('textbox', { name: 'Notes to organizer' }).fill(reason)
    await dialog.getByRole('button', { name: 'Reject' }).click()

    await expect(page.getByText('Application rejected')).toBeVisible()
    await expect(tableRow(page, app.munName)).toHaveCount(0)
    const review = await munReview(app.munId)
    expect(review.status).toBe('REJECTED')
    expect(review.verificationLogs.find((log) => log.action === 'REJECTED')?.notes).toBe(reason)
  })

  test('REJECT without a reason is refused', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: a Gate 1 rejection with no reason is accepted (notes optional in server/routes/admin-review.ts and the dialog); Admin PRD §8 says a rejection reason is mandatory',
    )
    const app = await createApplication()
    const api = await adminApi()
    const response = await api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'REJECTED' } })
    expect(response.status()).toBe(400)
    expect((await munReview(app.munId)).status).toBe('SUBMITTED')
  })

  test('an unknown decision value is rejected by the API', async () => {
    const app = await createApplication()
    const api = await adminApi()
    const response = await api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'PUBLISHED' } })
    expect(response.status()).toBe(400)
    expect((await munReview(app.munId)).status).toBe('SUBMITTED')
  })

  test('deciding the same application twice does not change the first decision', async () => {
    const app = await createApplication()
    const api = await adminApi()
    const first = await api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })
    expect(first.ok()).toBeTruthy()

    const second = await api.post(`admin/muns/${app.munId}/review-application`, {
      data: { decision: 'REJECTED', notes: 'second decision' },
    })
    expect(second.ok()).toBe(false)
    expect((await munReview(app.munId)).status).toBe('APPROVED')
  })

  test('a second decision is reported as a conflict, not a server error', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: "Invalid transition from X to Y" is not mapped in server/middleware/error.ts, so a repeat decision returns 500 INTERNAL instead of 409 CONFLICT_STATE',
    )
    const app = await createApplication()
    const api = await adminApi()
    await api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })
    const second = await api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })
    expect(second.status()).toBe(409)
  })
})
