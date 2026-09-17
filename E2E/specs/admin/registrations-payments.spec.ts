import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { DATABASE_URL, assertLocalDatabase } from '../../env'
import { getMun, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import { filterPaymentExceptions, heading, main, tableRow, uniqueName } from './_helpers'

/**
 * Admin Registrations + Payments views, driven by a fresh delegate's own
 * registration on the E2E Open MUN fixture.
 */

const DELEGATE_PASS = OPEN.products[0] // ₹1,499

async function registeredDelegate(outcome?: 'success' | 'failure') {
  const name = uniqueName('E2E Admin Delegate')
  const delegate = await signUpViaApi({ name })
  const mun = await getMun(delegate.api, OPEN.slug)
  const pass = mun.registrationProducts.find((p) => p.name === DELEGATE_PASS.name)!
  const response = await delegate.api.post('registrations', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { munId: mun.id, registrationProductId: pass.id },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { registrationId } = (await response.json()) as { registrationId: string }
  if (outcome) {
    const pay = await delegate.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome } })
    expect(pay.ok(), await pay.text()).toBeTruthy()
  }
  return { delegate, name, registrationId }
}

/** Releases a registration's seat hold the way the expiry sweep would. */
async function releaseSeatHold(registrationId: string) {
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    await sql`update registrations set status = 'CANCELLED', updated_at = now() where id = ${registrationId}`
  } finally {
    await sql.end()
  }
}

async function searchRegistrations(page: Page, q: string) {
  await page.goto('/admin/registrations')
  await expect(heading(page, 'Registrations')).toBeVisible()
  // The table keeps showing the unfiltered page until the debounced search
  // returns, so wait for that exact response before asserting on rows.
  const searched = page.waitForResponse(
    (response) =>
      response.url().includes('/admin/registrations?') && new URL(response.url()).searchParams.get('q') === q,
  )
  await main(page).getByRole('searchbox', { name: 'Search' }).fill(q)
  await searched
  await expect(page).toHaveURL(/[?&]q=/)
}

function registrationRow(page: Page, delegate: ApiSession) {
  return tableRow(page, delegate.email)
}

test.describe('admin registrations', () => {
  test('a fresh delegate\'s pending registration is found by their name', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const { delegate, name } = await registeredDelegate()
    await searchRegistrations(page, name)

    const row = registrationRow(page, delegate)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(name)
    await expect(row).toContainText(OPEN.name)
    await expect(row).toContainText('Payment pending')
    await expect(row).toContainText(/Order created|Payment processing/)
    await expect(main(page).getByText(/^1–1 of 1$/)).toBeVisible()
    crashes.assertNone()
  })

  test('a registration is found by its registration ID, and a paid one shows as confirmed', async ({ page }) => {
    const { delegate, registrationId } = await registeredDelegate('success')
    await searchRegistrations(page, registrationId)
    const row = registrationRow(page, delegate)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Confirmed')
    await expect(row).toContainText('Paid')
  })

  test('the search query is kept in the URL, so a search can be shared', async ({ page }) => {
    const { delegate, name } = await registeredDelegate()
    await page.goto(`/admin/registrations?q=${encodeURIComponent(name)}`)
    await expect(main(page).getByRole('searchbox', { name: 'Search' })).toHaveValue(name)
    await expect(registrationRow(page, delegate)).toHaveCount(1)
  })

  test('a search with no matches shows the empty state', async ({ page }) => {
    await searchRegistrations(page, `no-such-delegate-${randomUUID()}`)
    await expect(main(page).getByText('No registrations match that search.')).toBeVisible()
    await expect(main(page).getByText('No registrations', { exact: true })).toBeVisible()
  })

  test('a registration is findable by the delegate\'s email', async ({ page }) => {
    const { delegate } = await registeredDelegate()
    await searchRegistrations(page, delegate.email)
    await expect(registrationRow(page, delegate)).toHaveCount(1, { timeout: 5_000 })
  })
})

test.describe('admin payments', () => {
  test('renders the payment-exceptions view', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/admin/payments')
    await expect(heading(page, 'Payments')).toBeVisible()
    await expect(main(page)).toContainText(/Payment exceptions requiring manual review/)
    // The queue is filtered and paged like every other admin list.
    await expect(main(page).getByRole('searchbox', { name: 'Search' })).toBeVisible()
    await expect(main(page).getByRole('combobox', { name: 'Status' })).toHaveValue('open')
    const table = main(page).getByRole('table')
    await expect(table.or(main(page).getByText('No open payment exceptions'))).toBeVisible()
    if (await table.isVisible()) {
      for (const column of ['Registration', 'Delegate', 'MUN', 'Amount', 'Exception']) {
        await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
      }
      await expect(main(page).getByText(/^\d+ exceptions?$/)).toBeVisible()
    }
    crashes.assertNone()
  })

  test('a failed payment releases the seat but is not an exception (no money was taken)', async ({ page }) => {
    const { delegate, name, registrationId } = await registeredDelegate('failure')
    await page.goto('/admin/payments')
    await expect(heading(page, 'Payments')).toBeVisible()
    await filterPaymentExceptions(page, delegate.email)
    await expect(main(page).getByText('No open payment exceptions')).toBeVisible()
    await expect(tableRow(page, registrationId)).toHaveCount(0)

    await searchRegistrations(page, registrationId)
    const registration = tableRow(page, name)
    await expect(registration).toContainText('Cancelled')
    await expect(registration).toContainText('Payment failed')
  })

  test('a payment after the seat hold lapsed is an exception an admin resolves with a note', async ({ page }) => {
    const { delegate, name, registrationId } = await registeredDelegate()
    // The hold lapsing takes 15 minutes; release it directly instead.
    await releaseSeatHold(registrationId)
    const pay = await delegate.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    expect(await pay.json()).toEqual({ ok: true, exception: true })

    await page.goto('/admin/payments')
    await filterPaymentExceptions(page, delegate.email)
    const row = tableRow(page, registrationId)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(name)
    await expect(row).toContainText(OPEN.name)
    await expect(row).toContainText('₹1,499')
    await expect(row).toContainText('Paid after hold expired')

    await row.getByRole('button', { name: /resolve/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Resolve payment exception' })
    await expect(dialog.getByRole('button', { name: 'Mark resolved' })).toBeDisabled()
    await dialog.getByLabel('Resolution note').fill('Returned to the original payment method (E2E)')
    await dialog.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(dialog).toBeHidden()
    await expect(tableRow(page, registrationId)).toHaveCount(0)
  })

  test('a successfully paid, confirmed registration is not an exception', async ({ page }) => {
    const { delegate, registrationId } = await registeredDelegate('success')
    await page.goto('/admin/payments')
    await expect(heading(page, 'Payments')).toBeVisible()
    await filterPaymentExceptions(page, delegate.email)
    await expect(main(page).getByText('No open payment exceptions')).toBeVisible()
    await expect(tableRow(page, registrationId)).toHaveCount(0)
  })
})
