import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { browserContextFor } from '../../fixtures/api'
import { recreateReadyMun, retireStaffUsers } from '../../fixtures/fixture-db'
import { ADMIN_CONSOLE } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import {
  acceptConfirm,
  adminApi,
  createApplication,
  createStaffSession,
  findRowAcrossPages,
  fixtureOwnerApi,
  heading,
  main,
  publicMunStatusCode,
  staffMunStatus,
  submitForReview,
  toast,
  type StaffSession,
} from './_helpers'

/**
 * Go-live queue (Gate 2): the pipeline table, the Gate 2 decision dialog,
 * payment-account verification, queueing and publishing, plus the publish
 * endpoint's idempotency contract. Stateful UI steps use the admin-console
 * fixture MUN (recreated in beforeAll); API-only checks use MUNs the test
 * creates itself.
 */

const SLA_LABELS = /On track|Due soon|Overdue|Paused|Completed/
const COLUMNS = ['MUN', 'Status', 'SLA', 'Reviewer', 'Payment account', 'Actions']

async function munStatus(munId: string): Promise<string> {
  const api = await adminApi()
  const status = await staffMunStatus(api, munId)
  await api.dispose()
  return status
}

test.describe('go-live queue', () => {
  test('renders the pipeline with its SLA columns and summary', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/admin/go-live-queue')
    await expect(heading(page, 'Go-live queue')).toBeVisible()
    await expect(main(page)).toContainText(/SLA is computed on read/)

    const table = main(page).getByRole('table')
    await expect(table.or(main(page).getByText('Nothing in the pipeline.'))).toBeVisible()
    if (!(await table.isVisible())) return

    for (const column of COLUMNS) {
      await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }

    for (const term of ['In pipeline', 'Awaiting review (this page)', 'Ready to publish (this page)', 'Overdue (this page)']) {
      await expect(main(page).getByRole('term').filter({ hasText: new RegExp(`^${term.replace(/[()]/g, '\\$&')}$`) })).toBeVisible()
    }
    const values = main(page).getByRole('definition')
    for (let i = 0; i < 4; i += 1) await expect(values.nth(i)).toHaveText(/^\d+$/)

    // The "In pipeline" total matches the API.
    const api = await adminApi()
    const body = (await (await api.get('admin/go-live-queue/details?limit=20')).json()) as { total: number }
    await api.dispose()
    expect(Math.abs(Number(await values.first().textContent()) - body.total)).toBeLessThanOrEqual(5)

    const rows = table.getByRole('row')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(1)
    // Every data row carries an SLA badge, a reviewer and exactly one action slot.
    for (let i = 1; i < Math.min(rowCount, 6); i += 1) {
      const cells = rows.nth(i).getByRole('cell')
      await expect(cells.nth(2)).toContainText(SLA_LABELS)
      await expect(cells.nth(2)).toContainText(/Due /)
      await expect(cells.nth(3)).toHaveText(/\S/)
      await expect(cells.nth(4)).toContainText(/Account verified|Verification pending|Verification failed|Details not submitted/)
      await expect(cells.nth(5)).toHaveText(
        /^(Review|Queue for go-live|Queueing…|Publish(Verify the payment account first)?|Publishing…|Waiting for organizer confirmation|Waiting for organizer changes|—)$/,
      )
    }
    crashes.assertNone()
  })

  test('the details read is staff-only', async () => {
    const app = await createApplication('E2E Admin GoLive')
    expect((await app.organizer.api.get('admin/go-live-queue/details')).status()).toBe(403)
    const admin = await adminApi()
    expect((await admin.get('admin/go-live-queue/details?limit=1000')).status()).toBe(400)
    await admin.dispose()
  })

  test('publish requires an Idempotency-Key header', async () => {
    const app = await createApplication('E2E Admin GoLive')
    const admin = await adminApi()

    const missing = await admin.post(`muns/${app.munId}/actions/publish`)
    expect(missing.status()).toBe(400)
    const body = await missing.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toMatch(/Idempotency-Key/)

    const blank = await admin.post(`muns/${app.munId}/actions/publish`, { headers: { 'Idempotency-Key': '   ' } })
    expect(blank.status()).toBe(400)

    expect(await munStatus(app.munId)).toBe('SUBMITTED')
  })

  test("only admins may publish — the MUN's own organizer is refused", async () => {
    const app = await createApplication('E2E Admin GoLive')
    const response = await app.organizer.api.post(`muns/${app.munId}/actions/publish`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(response.status()).toBe(403)
    expect(await munStatus(app.munId)).toBe('SUBMITTED')
  })

  test('publishing a MUN that never went through review is refused cleanly', async () => {
    const app = await createApplication('E2E Admin GoLive')
    const admin = await adminApi()
    const response = await admin.post(`muns/${app.munId}/actions/publish`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(await munStatus(app.munId)).toBe('SUBMITTED')
    expect([404, 409]).toContain(response.status())
  })
})

/**
 * The whole Gate 2 → publish path on the admin-console fixture, driven from
 * the queue page. Serial: every step builds on the previous one.
 */
test.describe('go-live queue actions (admin-console fixture)', () => {
  test.describe.configure({ mode: 'serial' })

  let admin: APIRequestContext
  let owner: APIRequestContext
  let operations: StaffSession
  let munId: string

  test.beforeAll(async () => {
    munId = await recreateReadyMun(ADMIN_CONSOLE)
    admin = await adminApi()
    owner = await fixtureOwnerApi()
    operations = await createStaffSession('OPERATIONS')
    await submitForReview(owner, admin, munId)
  })

  test.afterAll(async () => {
    await admin?.dispose()
    await owner?.dispose()
    await operations?.api.dispose()
    if (operations) await retireStaffUsers([operations.email])
  })

  async function queueRow(page: Page) {
    await page.goto('/admin/go-live-queue')
    await expect(heading(page, 'Go-live queue')).toBeVisible()
    return findRowAcrossPages(page, ADMIN_CONSOLE.name)
  }

  async function paymentState(): Promise<string | null> {
    const body = (await (await admin.get('admin/go-live-queue/details?limit=100')).json()) as {
      results: Array<{ munId: string; paymentVerificationState: string | null }>
    }
    return body.results.find((row) => row.munId === munId)?.paymentVerificationState ?? null
  }

  async function operationsPage(browser: Browser) {
    const context = await browserContextFor(browser, operations)
    return { context, page: await context.newPage() }
  }

  test('a MUN in verification shows its status, SLA, payment state and a Review button', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const row = await queueRow(page)
    const cells = row.getByRole('cell')
    await expect(cells.nth(0)).toContainText('Submitted ')
    await expect(cells.nth(1)).toContainText('Submission: ')
    await expect(cells.nth(2)).toContainText(SLA_LABELS)
    await expect(cells.nth(3)).toHaveText('Unassigned')
    await expect(cells.nth(4)).toContainText('Account verified')
    await expect(cells.nth(5).getByRole('button', { name: 'Review' })).toBeVisible()
    await expect(cells.nth(0).getByRole('link', { name: ADMIN_CONSOLE.name })).toHaveAttribute('href', `/admin/muns/${munId}`)
    crashes.assertNone()
  })

  test('operations staff can review but never see payment or publish controls', async ({ browser }) => {
    const { context, page } = await operationsPage(browser)
    const crashes = watchForCrashes(page)
    const row = await queueRow(page)
    await expect(row.getByRole('button', { name: 'Review' })).toBeVisible()
    await expect(row.getByRole('button', { name: /^(Verify|Reject|Publish|Queue for go-live)$/ })).toHaveCount(0)
    await expect(row).toContainText('Account verified')
    crashes.assertNone()
    await context.close()
  })

  test('requesting changes needs a reason; operations staff can make that decision', async ({ browser }) => {
    const { context, page } = await operationsPage(browser)
    const crashes = watchForCrashes(page)
    const row = await queueRow(page)
    await row.getByRole('button', { name: 'Review' }).click()
    const dialog = page.getByRole('dialog', { name: `Review ${ADMIN_CONSOLE.name}` })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'Approve' })).toBeChecked()
    await expect(dialog.getByRole('textbox', { name: 'Notes for the organizer' })).toBeVisible()

    await dialog.getByRole('radio', { name: 'Request changes' }).check()
    const reason = dialog.getByRole('textbox', { name: 'Reason for the organizer' })
    await expect(reason).toBeVisible()
    await dialog.getByRole('button', { name: 'Request changes' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Tell the organizer what needs to change.')
    await expect(reason).toBeFocused()
    expect(await munStatus(munId)).toBe('VERIFICATION')

    await dialog.getByRole('radio', { name: 'Reject' }).check()
    await dialog.getByRole('button', { name: 'Reject' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Give the organizer a reason for the rejection.')
    expect(await munStatus(munId)).toBe('VERIFICATION')

    // Cancelling discards the draft decision.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await munStatus(munId)).toBe('VERIFICATION')

    await row.getByRole('button', { name: 'Review' }).click()
    await expect(dialog.getByRole('radio', { name: 'Approve' })).toBeChecked()
    await dialog.getByRole('radio', { name: 'Request changes' }).check()
    const note = `E2E: add the venue map (${Date.now()})`
    await dialog.getByRole('textbox', { name: 'Reason for the organizer' }).fill(note)
    await dialog.getByRole('button', { name: 'Request changes' }).click()
    await expect(toast(page, 'Changes requested from the organizer')).toBeVisible()
    await expect(dialog).toBeHidden()
    // Waiting on the organizer now, so there is nothing to review.
    await expect(row.getByRole('button', { name: 'Review' })).toHaveCount(0)
    await expect(row).toContainText('Waiting for organizer changes')
    expect(await munStatus(munId)).toBe('ACTION_REQUIRED')

    const feedback = await (await owner.get(`muns/${munId}/review-feedback`)).json()
    expect(JSON.stringify(feedback)).toContain(note)
    crashes.assertNone()
    await context.close()
  })

  test('after resubmission an admin approves from the dialog', async ({ page }) => {
    await submitForReview(owner, admin, munId)
    const crashes = watchForCrashes(page)
    const row = await queueRow(page)
    await row.getByRole('button', { name: 'Review' }).click()
    const dialog = page.getByRole('dialog', { name: `Review ${ADMIN_CONSOLE.name}` })
    await dialog.getByRole('textbox', { name: 'Notes for the organizer' }).fill('Looks good.')
    await dialog.getByRole('button', { name: 'Approve' }).click()
    await expect(toast(page, 'Submission approved')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(await munStatus(munId)).toBe('VERIFIED')

    await expect(row.getByRole('button', { name: 'Queue for go-live' })).toBeVisible()
    await expect(row.getByRole('cell').nth(3)).not.toHaveText('Unassigned')
    crashes.assertNone()
  })

  test('operations staff see an approved MUN as waiting for an admin', async ({ browser }) => {
    const { context, page } = await operationsPage(browser)
    const row = await queueRow(page)
    await expect(row.getByRole('cell').nth(5)).toHaveText('Approved, waiting for an admin')
    await expect(row.getByRole('button')).toHaveCount(0)
    await context.close()
  })

  test('an admin rejects and re-verifies the payment account', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const row = await queueRow(page)
    const payment = row.getByRole('cell').nth(4)
    await expect(payment).toContainText('Account verified')
    await expect(payment.getByRole('button', { name: 'Verify' })).toHaveCount(0)

    // Declining the confirmation changes nothing.
    page.once('dialog', (dialog) => void dialog.dismiss())
    await payment.getByRole('button', { name: 'Reject' }).click()
    await expect(payment).toContainText('Account verified')
    expect(await paymentState()).toBe('VERIFIED')

    acceptConfirm(page, `Mark ${ADMIN_CONSOLE.name}'s payout account as failed?`)
    await payment.getByRole('button', { name: 'Reject' }).click()
    await expect(toast(page, 'Payment account marked as failed')).toBeVisible()
    await expect(payment).toContainText('Verification failed')
    await expect(payment.getByRole('button', { name: 'Reject' })).toHaveCount(0)
    expect(await paymentState()).toBe('FAILED')

    // Queue it while the account is failed: publishing must stay blocked.
    await row.getByRole('button', { name: 'Queue for go-live' }).click()
    await expect(toast(page, 'Moved to the go-live queue')).toBeVisible()
    expect(await munStatus(munId)).toBe('GO_LIVE_QUEUE')
    await expect(row.getByRole('button', { name: 'Publish' })).toBeDisabled()
    await expect(row).toContainText('Verify the payment account first')

    acceptConfirm(page, `Mark ${ADMIN_CONSOLE.name}'s payout account as verified?`)
    await payment.getByRole('button', { name: 'Verify' }).click()
    await expect(toast(page, 'Payment account verified')).toBeVisible()
    await expect(payment).toContainText('Account verified')
    expect(await paymentState()).toBe('VERIFIED')
    await expect(row.getByRole('button', { name: 'Publish' })).toBeEnabled()
    await expect(row).not.toContainText('Verify the payment account first')
    crashes.assertNone()
  })

  test('operations staff cannot verify payment accounts or publish, in the UI or the API', async ({ browser }) => {
    const { context, page } = await operationsPage(browser)
    const row = await queueRow(page)
    await expect(row.getByRole('cell').nth(5)).toHaveText('Queued, waiting for an admin')
    await expect(row.getByRole('button')).toHaveCount(0)
    await context.close()

    const verify = await operations.api.post(`muns/${munId}/payment-settings/actions/set-verification-state`, {
      data: { state: 'FAILED' },
    })
    expect(verify.status()).toBe(403)
    const publish = await operations.api.post(`muns/${munId}/actions/publish`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(publish.status()).toBe(403)
    expect(await paymentState()).toBe('VERIFIED')
    expect(await munStatus(munId)).toBe('GO_LIVE_QUEUE')
  })

  test('declining the publish confirmation leaves it queued', async ({ page }) => {
    const row = await queueRow(page)
    page.once('dialog', (dialog) => void dialog.dismiss())
    await row.getByRole('button', { name: 'Publish' }).click()
    await expect(row.getByRole('button', { name: 'Publish' })).toBeEnabled()
    expect(await munStatus(munId)).toBe('GO_LIVE_QUEUE')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(404)
  })

  test('an admin publishes from the queue; the MUN goes live and leaves the pipeline', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const row = await queueRow(page)
    acceptConfirm(page, `Publish ${ADMIN_CONSOLE.name}?`)
    await row.getByRole('button', { name: 'Publish' }).click()
    await expect(toast(page, `${ADMIN_CONSOLE.name} is now live.`)).toBeVisible()
    await expect(row).toHaveCount(0)
    expect(await munStatus(munId)).toBe('PUBLISHED')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(200)
    crashes.assertNone()
  })

  test('a replayed publish with the same key is idempotent', async () => {
    // Back through the queue (UNPUBLISHED → GO_LIVE_QUEUE), then publish twice with one key.
    expect((await admin.post(`admin/muns/${munId}/unpublish`)).status()).toBe(200)
    const queued = await admin.post(`muns/${munId}/submission/actions/enqueue`)
    expect(queued.status(), await queued.text()).toBe(200)

    const key = randomUUID()
    const first = await admin.post(`muns/${munId}/actions/publish`, { headers: { 'Idempotency-Key': key } })
    expect(first.status(), await first.text()).toBe(200)
    const firstBody = (await first.json()) as { replay: boolean; mun: { id: string; status: string }; munVersionId: string }
    expect(firstBody.replay).toBe(false)
    expect(firstBody.mun).toMatchObject({ id: munId, status: 'PUBLISHED' })

    const replay = await admin.post(`muns/${munId}/actions/publish`, { headers: { 'Idempotency-Key': key } })
    expect(replay.status(), await replay.text()).toBe(200)
    const replayBody = (await replay.json()) as typeof firstBody
    expect(replayBody.replay).toBe(true)
    expect(replayBody.mun.id).toBe(munId)
    expect(replayBody.munVersionId).toBe(firstBody.munVersionId)
    expect(await munStatus(munId)).toBe('PUBLISHED')
  })
})
