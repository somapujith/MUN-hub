import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { browserContextFor, signUpViaApi } from '../../fixtures/api'
import { recreateReadyMun, retireStaffUsers } from '../../fixtures/fixture-db'
import { ADMIN_CONSOLE, FIXTURE_MUNS } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import {
  acceptConfirm,
  adminApi,
  createStaffSession,
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
 * Conferences console (/admin/muns, /admin/muns/:munId): search and status
 * filter, the detail page, and every visibility / lifecycle / payment /
 * module-requirement action on it, with the role-aware controls an
 * OPERATIONS account sees. Drives the admin-console fixture MUN (recreated in
 * beforeAll) through its whole life, so the file runs serially.
 */

test.describe.configure({ mode: 'serial' })

interface DetailModule {
  moduleName: string
  label: string
  isRequired: boolean
}

let admin: APIRequestContext
let owner: APIRequestContext
let operations: StaffSession
let munId: string

test.beforeAll(async () => {
  munId = await recreateReadyMun(ADMIN_CONSOLE)
  admin = await adminApi()
  owner = await fixtureOwnerApi()
  operations = await createStaffSession('OPERATIONS')
})

test.afterAll(async () => {
  await admin?.dispose()
  await owner?.dispose()
  await operations?.api.dispose()
  if (operations) await retireStaffUsers([operations.email])
})

async function status(): Promise<string> {
  return staffMunStatus(admin, munId)
}

async function detail(): Promise<{ modules: DetailModule[]; paymentSettings: { verificationState: string } | null }> {
  const response = await admin.get(`admin/muns/${munId}`)
  expect(response.status(), await response.text()).toBe(200)
  return response.json()
}

async function listIds(api: APIRequestContext, query: string): Promise<{ ids: string[]; total: number; status: number }> {
  const response = await api.get(`admin/muns?${query}`)
  if (!response.ok()) return { ids: [], total: 0, status: response.status() }
  const body = (await response.json()) as { results: Array<{ id: string }>; total: number }
  return { ids: body.results.map((row) => row.id), total: body.total, status: response.status() }
}

function section(page: Page, title: string): Locator {
  return main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
}

function actions(page: Page): Locator {
  return section(page, 'Actions')
}

/** The Status fact in the Overview section. */
function overviewStatus(page: Page): Locator {
  return section(page, 'Overview').getByRole('definition').first()
}

async function openDetail(page: Page): Promise<void> {
  await page.goto(`/admin/muns/${munId}`)
  await expect(heading(page, ADMIN_CONSOLE.name)).toBeVisible()
}

async function operationsPage(browser: Browser) {
  const context = await browserContextFor(browser, operations)
  return { context, page: await context.newPage() }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('conference list', () => {
  test('search by slug finds the MUN and links to its detail page', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/admin/muns')
    await expect(heading(page, 'Conferences')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Conferences' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const column of ['Conference', 'Organizer', 'Status', 'Dates', 'Registrations']) {
      await expect(main(page).getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }

    await main(page).getByRole('searchbox', { name: 'Search' }).fill(ADMIN_CONSOLE.slug)
    await expect(page).toHaveURL(new RegExp(`[?&]q=${ADMIN_CONSOLE.slug}(&|$)`))
    await expect(main(page).getByText('1 conference', { exact: true })).toBeVisible()
    const rows = main(page).getByRole('row')
    await expect(rows).toHaveCount(2)
    const row = rows.nth(1)
    await expect(row).toContainText(ADMIN_CONSOLE.slug)
    await expect(row).toContainText('Hyderabad')
    await expect(row).toContainText(FIXTURE_MUNS.ownerEmail)
    await expect(row).toContainText('Onboarding')
    await expect(row).toContainText('0 confirmed')

    await row.getByRole('link', { name: ADMIN_CONSOLE.name }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/muns/${munId}$`))
    await expect(heading(page, ADMIN_CONSOLE.name)).toBeVisible()
    crashes.assertNone()
  })

  test('the status filter lives in the URL and narrows the list', async ({ page }) => {
    await page.goto(`/admin/muns?q=${ADMIN_CONSOLE.slug}`)
    const status = main(page).getByRole('combobox', { name: 'Status' })
    await expect(status).toHaveValue('')

    await status.selectOption({ label: 'Onboarding' })
    await expect(page).toHaveURL(/[?&]status=ONBOARDING(&|$)/)
    await expect(page).toHaveURL(new RegExp(`[?&]q=${ADMIN_CONSOLE.slug}(&|$)`))
    await expect(main(page).getByRole('link', { name: ADMIN_CONSOLE.name })).toBeVisible()

    await status.selectOption({ label: 'Live' })
    await expect(page).toHaveURL(/[?&]status=PUBLISHED(&|$)/)
    await expect(main(page).getByText('No conferences match.')).toBeVisible()
    await expect(main(page).getByText('0 conferences', { exact: true })).toBeVisible()

    // A shared link restores both the search and the filter.
    await page.reload()
    await expect(status).toHaveValue('PUBLISHED')
    await expect(main(page).getByRole('searchbox', { name: 'Search' })).toHaveValue(ADMIN_CONSOLE.slug)
    await expect(main(page).getByText('No conferences match.')).toBeVisible()

    await status.selectOption({ label: 'All statuses' })
    await expect(page).not.toHaveURL(/status=/)
    await main(page).getByRole('searchbox', { name: 'Search' }).fill('')
    await expect(page).not.toHaveURL(/[?&]q=/)
    await expect(main(page).getByText(/^\d+ conferences?$/)).toBeVisible()
  })

  test('an unknown status in the URL is ignored', async ({ page }) => {
    await page.goto(`/admin/muns?q=${ADMIN_CONSOLE.slug}&status=NOT_A_STATUS`)
    await expect(main(page).getByRole('combobox', { name: 'Status' })).toHaveValue('')
    await expect(main(page).getByRole('link', { name: ADMIN_CONSOLE.name })).toBeVisible()
  })

  test('search matches name and organizer email, and treats % and _ literally', async () => {
    expect((await listIds(admin, `q=${encodeURIComponent(ADMIN_CONSOLE.name)}`)).ids).toContain(munId)
    expect((await listIds(admin, `q=${encodeURIComponent(ADMIN_CONSOLE.name.toUpperCase())}`)).ids).toContain(munId)
    expect(
      (await listIds(admin, `q=${encodeURIComponent(FIXTURE_MUNS.ownerEmail)}&status=ONBOARDING&limit=100`)).ids,
    ).toContain(munId)

    const all = await listIds(admin, 'limit=1')
    const percent = await listIds(admin, 'q=%25&limit=1')
    expect(percent.status).toBe(200)
    expect(percent.total).toBeLessThan(all.total)
    // `_` would match the slug's hyphens if it were a LIKE wildcard.
    expect((await listIds(admin, 'q=e2e_admin_console&limit=100')).ids).not.toContain(munId)
  })

  test('the list API validates its query and is staff-only', async () => {
    expect((await listIds(admin, 'status=NOT_A_STATUS')).status).toBe(400)
    expect((await listIds(admin, 'limit=500')).status).toBe(400)
    expect((await listIds(admin, 'unexpected=1')).status).toBe(400)
    expect((await listIds(operations.api, `q=${ADMIN_CONSOLE.slug}`)).ids).toEqual([munId])

    expect((await owner.get('admin/muns')).status()).toBe(403)
    expect((await owner.get(`admin/muns/${munId}`)).status()).toBe(403)
    const student = await signUpViaApi()
    expect((await student.api.get('admin/muns')).status()).toBe(403)
    expect((await student.api.get(`admin/muns/${munId}`)).status()).toBe(403)
    await student.api.dispose()
    expect((await admin.get(`admin/muns/${randomUUID()}`)).status()).toBe(404)
  })
})

test.describe('conference detail before submission', () => {
  test('shows the overview, payment account, modules and only a cancel action', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openDetail(page)
    await expect(main(page)).toContainText(`${ADMIN_CONSOLE.slug} · 2026`)
    await expect(overviewStatus(page)).toHaveText('Onboarding')
    await expect(section(page, 'Overview')).toContainText(FIXTURE_MUNS.ownerEmail)
    await expect(section(page, 'Overview')).toContainText('E2E Convention Centre, Hyderabad, India')
    await expect(section(page, 'Overview')).toContainText(/approved · /)
    await expect(main(page).getByRole('button', { name: 'All conferences' })).toHaveAttribute('href', '/admin/muns')
    await expect(main(page).getByRole('button', { name: 'Audit trail' })).toHaveAttribute('href', `/admin/audit/mun/${munId}`)
    // Not public yet.
    await expect(main(page).getByRole('button', { name: 'Public page' })).toHaveCount(0)

    await expect(actions(page)).toContainText('Every action is recorded in the audit trail.')
    await expect(actions(page).getByRole('button', { name: 'Review submission' })).toHaveCount(0)
    await expect(actions(page)).toContainText('Nothing to change from this status.')
    await expect(actions(page).getByRole('button')).toHaveText(['Cancel conference'])

    await expect(section(page, 'Current submission')).toContainText("The organizer hasn't submitted this MUN for review yet.")

    const payment = section(page, 'Payment account')
    await expect(payment).toContainText('Account verified')
    await expect(payment).toContainText(`${ADMIN_CONSOLE.name} Organizing Society`)
    await expect(payment).toContainText(/ending \d{4}/)
    await expect(payment.getByRole('button', { name: 'Reject account' })).toBeVisible()
    await expect(payment.getByRole('button', { name: 'Verify account' })).toHaveCount(0)

    const modules = section(page, 'Modules')
    const { modules: apiModules } = await detail()
    expect(apiModules).toHaveLength(15)
    await expect(modules.getByRole('row')).toHaveCount(16)
    for (const module of apiModules) {
      await expect(modules.getByRole('row').filter({ hasText: module.label })).toContainText(
        module.isRequired ? 'Required' : 'Optional',
      )
    }
    const finalReview = apiModules.find((m) => m.moduleName === 'FINAL_REVIEW')!
    await expect(modules.getByRole('checkbox', { name: new RegExp(`— ${escapeRegExp(finalReview.label)}$`) })).toBeDisabled()

    for (const status of ['Confirmed', 'Pending']) {
      await expect(section(page, 'Registrations').getByRole('term').filter({ hasText: new RegExp(`^${status}$`, 'i') })).toBeVisible()
    }
    crashes.assertNone()
  })

  test('an admin toggles a module between required and optional', async ({ page }) => {
    const { modules } = await detail()
    const target = modules.find((m) => m.isRequired && m.moduleName !== 'FINAL_REVIEW')!
    expect(target, 'a required, non-final module exists').toBeTruthy()

    await openDetail(page)
    const checkbox = section(page, 'Modules').getByRole('checkbox', { name: new RegExp(`— ${escapeRegExp(target.label)}$`) })
    await expect(checkbox).toBeChecked()
    await checkbox.click()
    await expect(toast(page, 'Module is now optional')).toBeVisible()
    await expect(checkbox).not.toBeChecked()
    expect((await detail()).modules.find((m) => m.moduleName === target.moduleName)?.isRequired).toBe(false)

    await checkbox.click()
    await expect(toast(page, 'Module is now required')).toBeVisible()
    await expect(checkbox).toBeChecked()
    expect((await detail()).modules.find((m) => m.moduleName === target.moduleName)?.isRequired).toBe(true)
  })

  test('module requirements can only be changed by admins, and FINAL_REVIEW stays required', async () => {
    const { modules } = await detail()
    const target = modules.find((m) => m.isRequired && m.moduleName !== 'FINAL_REVIEW')!
    const patch = (api: APIRequestContext, moduleName: string, isRequired: boolean) =>
      api.patch(`muns/${munId}/modules/${moduleName}/requirement`, { data: { isRequired } })

    expect((await patch(owner, target.moduleName, false)).status()).toBe(403)
    expect((await patch(operations.api, target.moduleName, false)).status()).toBe(403)
    const finalReview = await patch(admin, 'FINAL_REVIEW', false)
    expect(finalReview.status()).toBeGreaterThanOrEqual(400)
    expect(finalReview.status()).toBeLessThan(500)
    const after = (await detail()).modules
    expect(after.find((m) => m.moduleName === target.moduleName)?.isRequired).toBe(true)
    expect(after.find((m) => m.moduleName === 'FINAL_REVIEW')?.isRequired).toBe(true)
  })

  test('operations staff see the conference read-only', async ({ browser }) => {
    const { context, page } = await operationsPage(browser)
    const crashes = watchForCrashes(page)
    await openDetail(page)
    await expect(actions(page)).toContainText('Publishing, suspension and lifecycle changes need an admin.')
    await expect(actions(page)).toContainText('No review decision is pending.')
    await expect(actions(page).getByRole('heading', { name: /^(Visibility|Lifecycle)$/ })).toHaveCount(0)
    await expect(actions(page).getByRole('button')).toHaveCount(0)
    await expect(section(page, 'Modules').getByRole('checkbox')).toHaveCount(0)
    const payment = section(page, 'Payment account')
    await expect(payment).toContainText('Account verified')
    await expect(payment.getByRole('button')).toHaveCount(0)
    // Masked payout details are admin-only.
    await expect(payment).not.toContainText(`${ADMIN_CONSOLE.name} Organizing Society`)
    crashes.assertNone()
    await context.close()
  })

  test('operations staff are refused every visibility and admin-only lifecycle action at the API', async () => {
    const api = operations.api
    expect((await api.post(`admin/muns/${munId}/publish`)).status()).toBe(403)
    expect((await api.post(`admin/muns/${munId}/unpublish`)).status()).toBe(403)
    expect((await api.post(`admin/muns/${munId}/suspend`, { data: { reason: 'ops try' } })).status()).toBe(403)
    expect((await api.post(`admin/muns/${munId}/reinstate`)).status()).toBe(403)
    expect((await api.post(`muns/${munId}/submission/actions/enqueue`)).status()).toBe(403)
    expect((await api.get(`muns/${munId}/payment-settings`)).status()).toBe(403)
    const cancel = await api.post(`muns/${munId}/lifecycle/cancel`, { data: { reason: 'ops try' } })
    expect([403, 409]).toContain(cancel.status())
    expect(await status()).toBe('ONBOARDING')
  })
})

test.describe('review and publish from the detail page', () => {
  test('a submitted MUN can be reviewed from its detail page', async ({ page }) => {
    await submitForReview(owner, admin, munId)
    const crashes = watchForCrashes(page)
    await openDetail(page)
    await expect(overviewStatus(page)).toHaveText('In verification')
    const submission = section(page, 'Current submission')
    await expect(submission).toContainText('v1')
    await expect(submission).toContainText('Unassigned')
    await expect(submission).toContainText(/On track|Due soon|Overdue/)

    await actions(page).getByRole('button', { name: 'Review submission' }).click()
    const dialog = page.getByRole('dialog', { name: `Review ${ADMIN_CONSOLE.name}` })
    await dialog.getByRole('button', { name: 'Approve' }).click()
    await expect(toast(page, 'Submission approved')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(overviewStatus(page)).toHaveText('Verified')
    await expect(submission).toContainText('Approved')
    await expect(submission).not.toContainText('Unassigned')
    expect(await status()).toBe('VERIFIED')
    await expect(actions(page).getByRole('button', { name: 'Review submission' })).toHaveCount(0)
    crashes.assertNone()
  })

  test('operations staff can review but not queue an approved MUN', async ({ browser }) => {
    const { context, page } = await operationsPage(browser)
    await openDetail(page)
    await expect(overviewStatus(page)).toHaveText('Verified')
    await expect(actions(page).getByRole('button')).toHaveCount(0)
    await context.close()
  })

  test('an admin queues it, and publishing waits for a verified payment account', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openDetail(page)
    await actions(page).getByRole('button', { name: 'Queue for go-live' }).click()
    await expect(toast(page, 'Moved to the go-live queue')).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('Go-live queue')
    expect(await status()).toBe('GO_LIVE_QUEUE')
    const publish = actions(page).getByRole('button', { name: 'Publish' })
    await expect(publish).toBeEnabled()

    const payment = section(page, 'Payment account')
    acceptConfirm(page, 'Mark this payout account as failed?')
    await payment.getByRole('button', { name: 'Reject account' }).click()
    await expect(toast(page, 'Payment account marked as failed')).toBeVisible()
    await expect(payment).toContainText('Verification failed')
    await expect(publish).toBeDisabled()
    await expect(actions(page)).toContainText('Verify the payment account before publishing.')
    expect((await detail()).paymentSettings?.verificationState).toBe('FAILED')

    acceptConfirm(page, 'Mark this payout account as verified?')
    await payment.getByRole('button', { name: 'Verify account' }).click()
    await expect(toast(page, 'Payment account verified')).toBeVisible()
    await expect(payment).toContainText('Account verified')
    await expect(payment).toContainText(/Verified.*by /s)
    await expect(publish).toBeEnabled()
    expect((await detail()).paymentSettings?.verificationState).toBe('VERIFIED')
    crashes.assertNone()
  })

  test('an admin publishes; the public page link appears', async ({ page }) => {
    await openDetail(page)
    page.once('dialog', (dialog) => void dialog.dismiss())
    await actions(page).getByRole('button', { name: 'Publish' }).click()
    expect(await status()).toBe('GO_LIVE_QUEUE')

    acceptConfirm(page, `Publish ${ADMIN_CONSOLE.name}?`)
    await actions(page).getByRole('button', { name: 'Publish' }).click()
    await expect(toast(page, 'Published — the MUN is live')).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('Live')
    expect(await status()).toBe('PUBLISHED')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(200)
    await expect(main(page).getByRole('button', { name: 'Public page' })).toHaveAttribute('href', `/mun/${ADMIN_CONSOLE.slug}`)

    await expect(actions(page).getByRole('button')).toHaveText([
      'Unpublish',
      'Suspend',
      'Open registration',
      'Cancel conference',
    ])
    await expect(section(page, 'History')).toContainText('PUBLISHED')
  })
})

test.describe('visibility and lifecycle actions', () => {
  test('unpublishing hides the MUN', async ({ page }) => {
    await openDetail(page)
    page.once('dialog', (dialog) => void dialog.dismiss())
    await actions(page).getByRole('button', { name: 'Unpublish' }).click()
    expect(await status()).toBe('PUBLISHED')

    acceptConfirm(page, `Unpublish ${ADMIN_CONSOLE.name}?`)
    await actions(page).getByRole('button', { name: 'Unpublish' }).click()
    await expect(toast(page, 'Unpublished')).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('Unpublished')
    expect(await status()).toBe('UNPUBLISHED')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(404)
    await expect(main(page).getByRole('button', { name: 'Public page' })).toHaveCount(0)
  })

  test('an unpublished MUN is queued and published again from its page', async ({ page }) => {
    await openDetail(page)
    await expect(overviewStatus(page)).toHaveText('Unpublished')
    await expect(actions(page).getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    await actions(page).getByRole('button', { name: 'Queue for go-live' }).click()
    await expect(toast(page, 'Moved to the go-live queue')).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('Go-live queue')
    expect(await status()).toBe('GO_LIVE_QUEUE')

    acceptConfirm(page, `Publish ${ADMIN_CONSOLE.name}?`)
    await actions(page).getByRole('button', { name: 'Publish' }).click()
    await expect(toast(page, 'Published — the MUN is live')).toBeVisible()
    expect(await status()).toBe('PUBLISHED')
  })

  test('suspending needs a reason; cancelling the dialog changes nothing', async ({ page }) => {
    await openDetail(page)
    await actions(page).getByRole('button', { name: 'Suspend' }).click()
    const dialog = page.getByRole('dialog', { name: `Suspend ${ADMIN_CONSOLE.name}` })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Suspend MUN' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('A reason is required.')
    await expect(dialog.getByRole('textbox', { name: 'Reason' })).toBeFocused()
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('   ')
    await dialog.getByRole('button', { name: 'Suspend MUN' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('A reason is required.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await status()).toBe('PUBLISHED')

    expect((await admin.post(`admin/muns/${munId}/suspend`, { data: {} })).status()).toBe(400)
    expect((await admin.post(`admin/muns/${munId}/suspend`, { data: { reason: '' } })).status()).toBe(400)
    expect((await owner.post(`admin/muns/${munId}/suspend`, { data: { reason: 'mine' } })).status()).toBe(403)
    expect(await status()).toBe('PUBLISHED')
  })

  test('opening and closing registration from the lifecycle controls', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openDetail(page)
    page.once('dialog', (dialog) => void dialog.dismiss())
    await actions(page).getByRole('button', { name: 'Open registration' }).click()
    expect(await status()).toBe('PUBLISHED')

    acceptConfirm(page, 'Open registration?')
    await actions(page).getByRole('button', { name: 'Open registration' }).click()
    await expect(toast(page, 'Conference status updated')).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('Registration open')
    expect(await status()).toBe('REGISTRATION_OPEN')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(200)
    // Starting the conference from here closes registration on the way.
    for (const name of ['Suspend', 'Close registration', 'Start conference', 'Cancel conference']) {
      await expect(actions(page).getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(actions(page).getByRole('button', { name: /^(Open registration|Unpublish|Publish)$/ })).toHaveCount(0)

    acceptConfirm(page, 'Close registration?')
    await actions(page).getByRole('button', { name: 'Close registration' }).click()
    await expect(overviewStatus(page)).toHaveText('Registration closed')
    expect(await status()).toBe('REGISTRATION_CLOSED')
    await expect(actions(page).getByRole('button')).toHaveText(['Suspend', 'Start conference', 'Cancel conference'])
    crashes.assertNone()
  })

  test("starting a conference months early shows the server's refusal", async ({ page }) => {
    await openDetail(page)
    acceptConfirm(page, 'Mark the conference as running?')
    await actions(page).getByRole('button', { name: 'Start conference' }).click()
    await expect(toast(page, /The conference can be started from .*, the day before it begins/)).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('Registration closed')
    expect(await status()).toBe('REGISTRATION_CLOSED')
  })

  test('an admin suspends the MUN with a reason; it leaves the marketplace', async ({ page }) => {
    const reason = `E2E console suspension ${Date.now()}`
    await openDetail(page)
    await actions(page).getByRole('button', { name: 'Suspend' }).click()
    const dialog = page.getByRole('dialog', { name: `Suspend ${ADMIN_CONSOLE.name}` })
    await dialog.getByRole('textbox', { name: 'Reason' }).fill(reason)
    await dialog.getByRole('button', { name: 'Suspend MUN' }).click()
    await expect(toast(page, 'MUN suspended')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(overviewStatus(page)).toHaveText('Suspended')
    expect(await status()).toBe('SUSPENDED')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(404)
    await expect(actions(page).getByRole('button')).toHaveText(['Reinstate', 'Cancel conference'])
    await expect(section(page, 'History')).toContainText(reason)

    const list = await listIds(admin, `q=${ADMIN_CONSOLE.slug}&status=SUSPENDED`)
    expect(list.ids).toEqual([munId])
  })

  test('reinstating sends it back to verification', async ({ page }) => {
    await openDetail(page)
    page.once('dialog', (dialog) => void dialog.dismiss())
    await actions(page).getByRole('button', { name: 'Reinstate' }).click()
    expect(await status()).toBe('SUSPENDED')

    acceptConfirm(page, `Reinstate ${ADMIN_CONSOLE.name}?`)
    await actions(page).getByRole('button', { name: 'Reinstate' }).click()
    await expect(toast(page, 'Reinstated — the MUN is back in verification')).toBeVisible()
    await expect(overviewStatus(page)).toHaveText('In verification')
    expect(await status()).toBe('VERIFICATION')
    expect(await publicMunStatusCode(ADMIN_CONSOLE.slug)).toBe(404)
  })

  test('cancelling the conference needs a reason and ends its lifecycle', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openDetail(page)
    await actions(page).getByRole('button', { name: 'Cancel conference' }).click()
    const dialog = page.getByRole('dialog', { name: `Cancel ${ADMIN_CONSOLE.name}` })
    await dialog.getByRole('button', { name: 'Cancel conference' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('A reason is required.')
    expect(await status()).toBe('VERIFICATION')

    // The API refuses a cancellation without a reason too.
    const bare = await admin.post(`muns/${munId}/lifecycle/cancel`, { data: {} })
    expect(bare.status()).toBe(400)

    await dialog.getByRole('textbox', { name: 'Reason' }).fill(`E2E console cancellation ${Date.now()}`)
    await dialog.getByRole('button', { name: 'Cancel conference' }).click()
    await expect(toast(page, 'Conference status updated')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(overviewStatus(page)).toHaveText('Cancelled')
    expect(await status()).toBe('CANCELLED')
    await expect(actions(page)).toContainText('Nothing to change from this status.')
    await expect(actions(page)).toContainText('This conference has reached the end of its lifecycle.')
    await expect(actions(page).getByRole('button')).toHaveCount(0)
    crashes.assertNone()
  })
})
