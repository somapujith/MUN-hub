import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, createApplication, heading, main } from './_helpers'

/**
 * Go-live queue (Gate 2 exit): SLA view + the publish action's idempotency
 * contract. Publish calls only ever target a MUN this test created.
 */

const SLA_LABELS = /^(On track|Due soon|Overdue|Paused|Completed)$/

async function munStatus(munId: string): Promise<string> {
  const api = await adminApi()
  const response = await api.get(`admin/muns/${munId}/review`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { status: string }).status
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

    for (const column of ['MUN', 'Lifecycle status', 'Submission', 'Submitted', 'SLA deadline', 'SLA state', 'Queued', 'Actions']) {
      await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }

    const summary = main(page).getByRole('definition')
    await expect(main(page).getByRole('term').filter({ hasText: /^In pipeline$/ })).toBeVisible()
    await expect(main(page).getByRole('term').filter({ hasText: /^Ready to publish \(this page\)$/ })).toBeVisible()
    await expect(summary.first()).toHaveText(/^\d+$/)
    await expect(summary.nth(1)).toHaveText(/^\d+$/)

    const rows = table.getByRole('row')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(1)
    // Every data row carries an SLA state badge and exactly one action slot.
    for (let i = 1; i < Math.min(rowCount, 6); i += 1) {
      const cells = rows.nth(i).getByRole('cell')
      await expect(cells.nth(5)).toHaveText(SLA_LABELS)
      await expect(cells.nth(7)).toHaveText(/^(Publish|Queue for go-live|Awaiting Gate 2 decision)$/)
    }
    crashes.assertNone()
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

  test('only admins may publish — the MUN\'s own organizer is refused', async () => {
    const app = await createApplication('E2E Admin GoLive')
    const response = await app.organizer.api.post(`muns/${app.munId}/actions/publish`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(response.status()).toBe(403)
    expect(await munStatus(app.munId)).toBe('SUBMITTED')
  })

  test('publishing a MUN that never went through review is refused cleanly', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: publishFromQueue throws "No submission found for this mun", which server/middleware/error.ts does not map — the admin gets 500 INTERNAL instead of a 404/409',
    )
    const app = await createApplication('E2E Admin GoLive')
    const admin = await adminApi()
    const response = await admin.post(`muns/${app.munId}/actions/publish`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(await munStatus(app.munId)).toBe('SUBMITTED')
    expect([404, 409]).toContain(response.status())
  })

  test('a replayed publish with the same key is idempotent', async () => {
    test.fixme(
      true,
      'Unreachable end-to-end: an approved application stays APPROVED (no APPROVED -> ONBOARDING exit, see applications.spec.ts), so a test-created MUN can never be submitted for review, reach GO_LIVE_QUEUE, and be published. Fixture MUNs must not be status-changed.',
    )
  })
})
