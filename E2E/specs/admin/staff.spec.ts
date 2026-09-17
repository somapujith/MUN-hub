import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { browserContextFor, newApiContext, signUpViaApi } from '../../fixtures/api'
import { ACCOUNTS } from '../../fixtures/accounts'
import { createStaffUser, retireStaffUsers, userRole } from '../../fixtures/fixture-db'
import { uniqueEmail } from '../../fixtures/data'
import { watchForCrashes } from '../../fixtures/ui'
import {
  acceptConfirm,
  adminApi,
  createOrganizer,
  createStaffSession,
  heading,
  main,
  toast,
  uniqueName,
  type StaffSession,
} from './_helpers'

/**
 * Staff console (/admin/staff). Every staff role can read the directory;
 * only a SUPER_ADMIN can add staff, change roles, suspend / reinstate, or
 * issue set-password links. The seeded admin@munhub.test is a plain ADMIN,
 * so a SUPER_ADMIN is created in the local database for this file. The
 * super-admin tests share one staff member, so the file runs serially.
 */

test.describe.configure({ mode: 'serial' })

const NEW_PASSWORD = 'e2e-staff-new-password'

interface StaffRow {
  id: string
  email: string
  role: string
  suspended: boolean
  suspendedReason: string | null
  passwordSet: boolean
}

let superAdmin: StaffSession
let superContext: BrowserContext
let superPage: Page
let admin: APIRequestContext
/** The staff member the super admin creates through the UI and then manages. */
let member: { name: string; email: string; id: string; setPasswordUrl: string }
/** The member's own signed-in session. Sign-ins are rate-limited to 5/min per account, so it is reused. */
let memberApi: APIRequestContext
const createdEmails: string[] = []

test.beforeAll(async ({ browser }) => {
  superAdmin = await createStaffSession('SUPER_ADMIN')
  createdEmails.push(superAdmin.email)
  admin = await adminApi()
  ;({ context: superContext, page: superPage } = await openAs(browser, superAdmin))
})

test.afterAll(async () => {
  await superContext?.close()
  await admin?.dispose()
  await superAdmin?.api.dispose()
  await memberApi?.dispose()
  await retireStaffUsers(createdEmails)
})

async function openAs(browser: Browser, session: StaffSession) {
  const context = await browserContextFor(browser, session)
  return { context, page: await context.newPage() }
}

async function findStaff(api: APIRequestContext, email: string): Promise<StaffRow | undefined> {
  const response = await api.get(`admin/staff?q=${encodeURIComponent(email)}`)
  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as { results: StaffRow[] }
  return body.results.find((row) => row.email === email)
}

async function signInStatus(email: string, password: string): Promise<{ status: number; message?: string }> {
  const api = await newApiContext()
  const response = await api.post('auth/session', { data: { email, password } })
  const body = response.ok() ? null : ((await response.json()) as { error?: { message?: string } })
  await api.dispose()
  return { status: response.status(), message: body?.error?.message }
}

function tokenOf(url: string): string {
  const parsed = new URL(url)
  expect(parsed.pathname).toBe('/reset-password')
  const token = parsed.searchParams.get('token')
  expect(token).toBeTruthy()
  return token!
}

async function confirmReset(token: string, newPassword = NEW_PASSWORD) {
  const api = await newApiContext()
  const response = await api.post('password-reset/confirm', { data: { token, newPassword } })
  const result = { status: response.status(), body: response.status() === 204 ? null : await response.json() }
  await api.dispose()
  return result
}

async function openStaffPage(page: Page, search?: string): Promise<void> {
  await page.goto('/admin/staff')
  await expect(heading(page, 'Staff')).toBeVisible()
  if (search) await searchStaff(page, search)
}

function staffRow(page: Page, email: string): Locator {
  return main(page).getByRole('row').filter({ hasText: email })
}

/**
 * Searches for a staff member expected to be listed. Re-applies the query if
 * the page lost it (a remount, e.g. a dev-server reload while other sessions
 * edit the app).
 */
async function searchStaff(page: Page, email: string): Promise<void> {
  const box = main(page).getByRole('searchbox', { name: 'Search' })
  await expect(async () => {
    if ((await box.inputValue()) !== email) await box.fill(email)
    await expect(staffRow(page, email)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

/** A fresh staff account (DB insert) for the write-refusal checks; retired afterwards. */
async function freshStaff(role: 'OPERATIONS' | 'ADMIN') {
  const user = await createStaffUser(role, { email: uniqueEmail('staff-target'), name: uniqueName('E2E Staff Target') })
  createdEmails.push(user.email)
  return user
}

test.describe('read-only for anyone but a super admin', () => {
  test('an ADMIN sees the directory without any controls', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openStaffPage(page)
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Staff' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(main(page)).toContainText('You can view the staff list. Ask a super admin to add someone or change access.')
    await expect(main(page).getByRole('button', { name: 'Add staff member' })).toHaveCount(0)
    for (const column of ['Name', 'Role', 'Status', 'Added']) {
      await expect(main(page).getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }
    await expect(main(page).getByRole('columnheader', { name: 'Actions' })).toHaveCount(0)

    await searchStaff(page, superAdmin.email)
    const row = staffRow(page, superAdmin.email)
    await expect(row).toContainText(superAdmin.name)
    await expect(row).toContainText('Super admin')
    await expect(row).toContainText('Active')
    await expect(row.getByRole('combobox')).toHaveCount(0)
    await expect(row.getByRole('button')).toHaveCount(0)

    await searchStaff(page, ACCOUNTS.admin.email)
    await expect(staffRow(page, ACCOUNTS.admin.email)).toContainText('(you)')
    crashes.assertNone()
  })

  test('operations staff can read the directory but not write', async ({ browser }) => {
    const ops = await createStaffSession('OPERATIONS')
    createdEmails.push(ops.email)
    const { context, page } = await openAs(browser, ops)
    await openStaffPage(page, ops.email)
    await expect(staffRow(page, ops.email)).toContainText('Operations')
    await expect(main(page).getByRole('button')).toHaveCount(0)
    await context.close()

    expect(await findStaff(ops.api, ops.email)).toMatchObject({ role: 'OPERATIONS', passwordSet: true })
    const target = await freshStaff('OPERATIONS')
    await expectWritesRefused(ops.api, target.userId)
    await ops.api.dispose()
  })

  test('the seeded ADMIN is refused every staff write', async () => {
    const target = await freshStaff('OPERATIONS')
    await expectWritesRefused(admin, target.userId)
  })

  test('delegates and organizers cannot read the staff directory', async () => {
    const student = await signUpViaApi()
    expect((await student.api.get('admin/staff')).status()).toBe(403)
    await student.api.dispose()
    const organizer = await createOrganizer()
    expect((await organizer.api.get('admin/staff')).status()).toBe(403)
    await organizer.api.dispose()
    const anon = await newApiContext()
    expect((await anon.get('admin/staff')).status()).toBe(401)
    await anon.dispose()
  })
})

async function expectWritesRefused(api: APIRequestContext, targetId: string) {
  const email = uniqueEmail('staff-refused')
  const attempts = [
    api.post('admin/staff', { data: { name: 'Nope', email, role: 'SUPER_ADMIN' } }),
    api.patch(`admin/staff/${targetId}/role`, { data: { role: 'SUPER_ADMIN' } }),
    api.post(`admin/staff/${targetId}/suspend`, { data: { reason: 'nope' } }),
    api.post(`admin/staff/${targetId}/reinstate`),
    api.post(`admin/staff/${targetId}/set-password-link`),
  ]
  for (const response of await Promise.all(attempts)) {
    expect(response.status(), `${response.url()} → ${response.status()}`).toBe(403)
  }
  expect(await userRole(targetId)).toEqual({ role: 'OPERATIONS', suspended: false })
  expect(await findStaff(admin, email)).toBeUndefined()
}

test.describe('super admin', () => {
  test('adds a staff member and gets a one-time set-password link', async () => {
    const page = superPage
    const crashes = watchForCrashes(page)
    const name = uniqueName('E2E New Staff')
    const email = uniqueEmail('staff-new')
    createdEmails.push(email)

    await openStaffPage(page)
    await expect(main(page)).not.toContainText('You can view the staff list.')
    await expect(main(page).getByRole('columnheader', { name: 'Actions' })).toBeVisible()
    await main(page).getByRole('button', { name: 'Add staff member' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add staff member' })
    await expect(dialog).toBeVisible()

    // Name and email are required.
    await dialog.getByRole('button', { name: 'Add and get link' }).click()
    await expect(dialog).toBeVisible()
    expect(await findStaff(superAdmin.api, email)).toBeUndefined()

    await dialog.getByRole('textbox', { name: 'Full name' }).fill(name)
    await dialog.getByRole('textbox', { name: 'Work email' }).fill(email)
    const role = dialog.getByRole('combobox', { name: 'Role' })
    await expect(role).toHaveValue('OPERATIONS')
    await expect(dialog).toContainText("Can't publish or change what is public.")
    await role.selectOption({ label: 'Admin' })
    await expect(dialog).toContainText('plus publishing, suspensions, payment verification and lifecycle changes')
    await dialog.getByRole('button', { name: 'Add and get link' }).click()

    const linkDialog = page.getByRole('dialog', { name: `${name} was added` })
    await expect(linkDialog).toBeVisible()
    await expect(linkDialog).toContainText(`Send this link to ${email} yourself.`)
    const link = linkDialog.getByRole('textbox', { name: 'Set-password link' })
    await expect(link).toHaveValue(/\/reset-password\?token=/)
    const setPasswordUrl = await link.inputValue()
    await linkDialog.getByRole('button', { name: 'Done' }).click()
    await expect(linkDialog).toBeHidden()

    const created = await findStaff(superAdmin.api, email)
    expect(created).toMatchObject({ role: 'ADMIN', suspended: false, passwordSet: false })
    member = { name, email, id: created!.id, setPasswordUrl }

    await searchStaff(page, email)
    const row = staffRow(page, email)
    await expect(row).toContainText(name)
    await expect(row).toContainText('Password not set')
    await expect(row.getByRole('combobox', { name: `Role for ${name}` })).toHaveValue('ADMIN')
    await expect(row.getByRole('button', { name: 'New password link' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Suspend' })).toBeVisible()

    crashes.assertNone()
  })

  test('the new staff member sets a password through the link and signs in', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    const token = tokenOf(member.setPasswordUrl)
    await page.goto(`/reset-password?token=${encodeURIComponent(token)}`)
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
    await main(page).getByRole('button', { name: 'Reset password' }).click()
    await expect(page).toHaveURL(/\/login\?reset=success$/)
    await context.close()

    memberApi = await newApiContext()
    expect((await memberApi.post('auth/session', { data: { email: member.email, password: NEW_PASSWORD } })).status()).toBe(200)
    // The link works once.
    const reuse = await confirmReset(token, 'another-password-1')
    expect(reuse.status).toBe(400)

    expect(await findStaff(superAdmin.api, member.email)).toMatchObject({ passwordSet: true })
    await openStaffPage(superPage, member.email)
    await expect(staffRow(superPage, member.email)).toContainText('Active')
  })

  test('refuses duplicate, non-staff and malformed accounts', async () => {
    const create = (data: Record<string, unknown>) => superAdmin.api.post('admin/staff', { data })
    expect((await create({ name: 'Dup', email: member.email, role: 'OPERATIONS' })).status()).toBe(409)
    expect((await create({ name: 'Dup', email: member.email.toUpperCase(), role: 'OPERATIONS' })).status()).toBe(409)
    // An existing delegate is never turned into staff from the console.
    const student = await signUpViaApi()
    expect((await create({ name: 'Delegate', email: student.email, role: 'ADMIN' })).status()).toBe(409)
    expect(await userRole(student.userId)).toEqual({ role: 'STUDENT', suspended: false })

    const email = uniqueEmail('staff-bad')
    expect((await create({ name: 'Bad role', email, role: 'STUDENT' })).status()).toBe(400)
    expect((await create({ name: 'Bad role', email, role: 'ORGANIZER' })).status()).toBe(400)
    expect((await create({ name: 'Bad email', email: 'not-an-email', role: 'ADMIN' })).status()).toBe(400)
    expect((await create({ name: '', email, role: 'ADMIN' })).status()).toBe(400)
    expect((await create({ name: 'Extra', email, role: 'ADMIN', passwordHash: 'x' })).status()).toBe(400)
    expect(await findStaff(superAdmin.api, email)).toBeUndefined()

    // Staff actions only ever target staff accounts.
    for (const id of [student.userId, randomUUID()]) {
      expect((await superAdmin.api.patch(`admin/staff/${id}/role`, { data: { role: 'ADMIN' } })).status()).toBe(404)
      expect((await superAdmin.api.post(`admin/staff/${id}/suspend`, { data: { reason: 'x' } })).status()).toBe(404)
      expect((await superAdmin.api.post(`admin/staff/${id}/set-password-link`)).status()).toBe(404)
    }
    expect(await userRole(student.userId)).toEqual({ role: 'STUDENT', suspended: false })
    await student.api.dispose()
  })

  test('changes a role after confirmation; declining changes nothing', async () => {
    const page = superPage
    await openStaffPage(page, member.email)
    const select = staffRow(page, member.email).getByRole('combobox', { name: `Role for ${member.name}` })
    await expect(select).toHaveValue('ADMIN')

    page.once('dialog', (dialog) => void dialog.dismiss())
    await select.selectOption('SUPER_ADMIN')
    await expect(select).toHaveValue('ADMIN')
    expect((await findStaff(superAdmin.api, member.email))?.role).toBe('ADMIN')

    acceptConfirm(page, `Change ${member.name} from Admin to Operations?`)
    await select.selectOption('OPERATIONS')
    await expect(toast(page, `${member.name} is now operations`)).toBeVisible()
    await expect(select).toHaveValue('OPERATIONS')
    expect((await findStaff(superAdmin.api, member.email))?.role).toBe('OPERATIONS')

    // The role is re-read on every request: their open session is now OPERATIONS.
    const session = memberApi
    expect(((await (await session.get('auth/session')).json()) as { role: string }).role).toBe('OPERATIONS')
    expect((await session.post(`admin/muns/${randomUUID()}/publish`)).status()).toBe(403)
    expect((await superAdmin.api.patch(`admin/staff/${member.id}/role`, { data: { role: 'ADMIN' } })).status()).toBe(200)
    expect(((await (await session.get('auth/session')).json()) as { role: string }).role).toBe('ADMIN')

    expect((await superAdmin.api.patch(`admin/staff/${member.id}/role`, { data: { role: 'STUDENT' } })).status()).toBe(400)
    expect((await findStaff(superAdmin.api, member.email))?.role).toBe('ADMIN')
  })

  test('issues a new set-password link; only the newest link works', async () => {
    const page = superPage
    await openStaffPage(page, member.email)
    const row = staffRow(page, member.email)

    page.once('dialog', (dialog) => void dialog.dismiss())
    await row.getByRole('button', { name: 'New password link' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    acceptConfirm(page, `Issue a new set-password link for ${member.name}?`)
    await row.getByRole('button', { name: 'New password link' }).click()
    const dialog = page.getByRole('dialog', { name: `New link for ${member.name}` })
    await expect(dialog).toBeVisible()
    const first = tokenOf(await dialog.getByRole('textbox', { name: 'Set-password link' }).inputValue())
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    const response = await superAdmin.api.post(`admin/staff/${member.id}/set-password-link`)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    const second = tokenOf(((await response.json()) as { setPasswordUrl: string }).setPasswordUrl)
    expect(second).not.toBe(first)

    const stale = await confirmReset(first)
    expect(stale.status).toBe(400)
    expect(stale.body.error.message).toBe('This reset link is invalid or has expired')
    expect((await confirmReset(second)).status).toBe(204)
    // Using a set-password link signs the account out everywhere.
    expect(await (await memberApi.get('auth/session')).json()).toBeNull()
  })

  test('never exposes password hashes or tokens in the directory or audit feed', async () => {
    const response = await superAdmin.api.get(`admin/staff?q=${encodeURIComponent(member.email)}`)
    const text = await response.text()
    expect(text).not.toMatch(/passwordHash|password_hash|token/i)
    const audit = await (await admin.get('admin/audit?limit=100')).text()
    expect(audit).toContain('STAFF_CREATED')
    expect(audit).not.toMatch(/reset-password\?token=/)
  })

  test('suspends with a reason, which signs the member out; reinstating restores access', async () => {
    const page = superPage
    const crashes = watchForCrashes(page)
    expect((await memberApi.post('auth/session', { data: { email: member.email, password: NEW_PASSWORD } })).status()).toBe(200)

    await openStaffPage(page, member.email)
    const row = staffRow(page, member.email)
    await row.getByRole('button', { name: 'Suspend' }).click()
    const dialog = page.getByRole('dialog', { name: `Suspend ${member.name}` })
    await dialog.getByRole('button', { name: 'Suspend account' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('A reason is required.')
    expect((await findStaff(superAdmin.api, member.email))?.suspended).toBe(false)
    expect((await superAdmin.api.post(`admin/staff/${member.id}/suspend`, { data: { reason: '  ' } })).status()).toBe(400)
    expect((await superAdmin.api.post(`admin/staff/${member.id}/suspend`, { data: {} })).status()).toBe(400)

    const reason = `E2E staff suspension ${Date.now()}`
    await dialog.getByRole('textbox', { name: 'Reason' }).fill(reason)
    await dialog.getByRole('button', { name: 'Suspend account' }).click()
    await expect(toast(page, `${member.name} is suspended and signed out`)).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Suspended')
    await expect(row).toContainText(reason)
    await expect(row.getByRole('button', { name: 'New password link' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Reinstate' })).toBeVisible()

    expect(await (await memberApi.get('auth/session')).json()).toBeNull()
    const blocked = await signInStatus(member.email, NEW_PASSWORD)
    expect(blocked.status).toBe(403)
    expect(blocked.message).toBe('Account suspended')
    expect((await superAdmin.api.post(`admin/staff/${member.id}/suspend`, { data: { reason: 'again' } })).status()).toBe(409)
    expect((await superAdmin.api.post(`admin/staff/${member.id}/set-password-link`)).status()).toBe(409)

    page.once('dialog', (confirmDialog) => void confirmDialog.dismiss())
    await row.getByRole('button', { name: 'Reinstate' }).click()
    await expect(row).toContainText('Suspended')

    acceptConfirm(page, `Reinstate ${member.name}?`)
    await row.getByRole('button', { name: 'Reinstate' }).click()
    await expect(toast(page, `${member.name} can sign in again`)).toBeVisible()
    await expect(row).toContainText('Active')
    await expect(row).not.toContainText(reason)
    expect((await superAdmin.api.post(`admin/staff/${member.id}/reinstate`)).status()).toBe(409)
    expect((await signInStatus(member.email, NEW_PASSWORD)).status).toBe(200)
    crashes.assertNone()
  })

  test("can't change their own account", async () => {
    const page = superPage
    await openStaffPage(page, superAdmin.email)
    const row = staffRow(page, superAdmin.email)
    await expect(row).toContainText('(you)')
    await expect(row.getByRole('combobox')).toHaveCount(0)
    await expect(row.getByRole('button')).toHaveCount(0)
    await expect(row.getByRole('cell').last()).toHaveText('—')

    const self = superAdmin.userId
    expect((await superAdmin.api.patch(`admin/staff/${self}/role`, { data: { role: 'OPERATIONS' } })).status()).toBe(409)
    expect((await superAdmin.api.post(`admin/staff/${self}/suspend`, { data: { reason: 'me' } })).status()).toBe(409)
    expect((await superAdmin.api.post(`admin/staff/${self}/set-password-link`)).status()).toBe(409)
    expect(await userRole(self)).toEqual({ role: 'SUPER_ADMIN', suspended: false })
  })

  test('filters the directory by role', async () => {
    const page = superPage
    await openStaffPage(page, member.email)
    const filter = main(page).getByRole('combobox', { name: 'Role', exact: true })
    await filter.selectOption({ label: 'Admin' })
    await expect(staffRow(page, member.email)).toBeVisible()
    await filter.selectOption({ label: 'Super admin' })
    await expect(main(page).getByText('No staff match.')).toBeVisible()
    await filter.selectOption({ label: 'All roles' })
    await expect(staffRow(page, member.email)).toBeVisible()

    const operationsOnly = (await (await superAdmin.api.get('admin/staff?role=OPERATIONS&limit=100')).json()) as {
      results: StaffRow[]
    }
    expect(operationsOnly.results.every((row) => row.role === 'OPERATIONS')).toBe(true)
    expect((await superAdmin.api.get('admin/staff?role=STUDENT')).status()).toBe(400)
    // Delegates never show up in the staff directory.
    const students = (await (await superAdmin.api.get(`admin/staff?q=${encodeURIComponent(ACCOUNTS.student.email)}`)).json()) as {
      results: StaffRow[]
    }
    expect(students.results).toEqual([])
  })
})
