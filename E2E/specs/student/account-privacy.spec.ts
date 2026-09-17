import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { DATABASE_URL, assertLocalDatabase } from '../../env'
import {
  browserContextFor,
  newApiContext,
  signInViaApi,
  signUpOrganizerViaApi,
  signUpViaApi,
  type ApiSession,
} from '../../fixtures/api'
import { signUpPayload } from '../../fixtures/data'
import { OPEN } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { registerOnOpenMun } from './_helpers'

/**
 * Privacy self-service (60e1a69, 743bbdd): "Download my data"
 * (GET /account/export) and account deletion (POST /account/delete), which
 * anonymizes the account instead of removing its registration and payment
 * records. Every test uses its own fresh delegate.
 */

test.use({ storageState: { cookies: [], origins: [] } })

interface ExportData {
  format: string
  version: number | string
  exportedAt: string
  account: { id: string; name: string; email: string; phone: string | null; institution: string | null; role: string }
  studentProfile: Record<string, unknown> | null
  consents: Array<{ consentType: string; policyVersion: string; acceptedAt: string }>
  registrations: Array<{ id: string; mun: { name: string }; status: string }>
  payments: Array<{ registrationId: string; amount: number; currency: string; status: string }>
  supportTickets: unknown[]
}

async function registrationStatus(id: string): Promise<string> {
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const [row] = await sql<{ status: string }[]>`select status from registrations where id = ${id}`
    return row.status
  } finally {
    await sql.end()
  }
}

async function userRow(id: string) {
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const [row] = await sql<
      { name: string; email: string; phone: string | null; institution: string | null; password_hash: string | null }[]
    >`select name, email, phone, institution, password_hash from users where id = ${id}`
    const [profile] = await sql`select 1 from student_profiles where user_id = ${id}`
    return { ...row, hasProfile: Boolean(profile) }
  } finally {
    await sql.end()
  }
}

function deleteAccount(session: ApiSession, data: Record<string, unknown>) {
  return session.api.post('account/delete', { data })
}

test.describe('data export — API', () => {
  test('returns everything about the signed-in delegate, and only them', async () => {
    const other = await signUpViaApi({ name: 'E2E Someone Else' })
    await registerOnOpenMun(other, { pay: true })

    const me = await signUpViaApi({ name: 'E2E Export Me' })
    const paid = await registerOnOpenMun(me, { pay: true })

    const res = await me.api.get('account/export')
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toContain('no-store')
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="munhub-data-\d{4}-\d{2}-\d{2}\.json"$/)

    const text = await res.text()
    const data = JSON.parse(text) as ExportData
    expect(data.account).toMatchObject({ id: me.userId, name: 'E2E Export Me', email: me.email, role: 'STUDENT' })
    expect(data.studentProfile).not.toBeNull()
    expect(data.consents.map((c) => c.consentType)).toEqual(
      expect.arrayContaining(['TERMS_OF_SERVICE', 'PRIVACY_POLICY']),
    )
    expect(data.registrations).toHaveLength(1)
    expect(data.registrations[0]).toMatchObject({ id: paid, mun: { name: OPEN.name } })
    expect(data.payments.find((p) => p.registrationId === paid)).toMatchObject({ currency: 'INR' })

    // Nothing that isn't theirs, and nothing secret.
    expect(text).not.toContain(other.email)
    expect(text).not.toContain(other.userId)
    expect(text).not.toMatch(/passwordHash|password_hash|scrypt|ciphertext/i)
    await me.api.dispose()
    await other.api.dispose()
  })

  test('a signed-out caller gets nothing', async () => {
    const anon = await newApiContext()
    expect((await anon.get('account/export')).status()).toBe(401)
    expect((await anon.post('account/delete', { data: { confirmation: 'DELETE', password: 'x' } })).status()).toBe(401)
    await anon.dispose()
  })
})

test.describe('account deletion — API', () => {
  test('needs the exact confirmation word and the right password', async () => {
    const me = await signUpViaApi()
    for (const [data, status] of [
      [{ confirmation: 'delete please', password: me.password }, 400],
      [{ confirmation: 'DELETE', password: 'not-my-password' }, 401],
      [{ confirmation: 'DELETE' }, 400],
      [{ confirmation: 'DELETE', password: me.password, userId: crypto.randomUUID() }, 400],
    ] as const) {
      const res = await deleteAccount(me, data)
      expect(res.status(), JSON.stringify(data)).toBe(status)
    }
    // Still signed in and intact.
    expect(await (await me.api.get('auth/session')).json()).toMatchObject({ userId: me.userId })
    expect((await me.api.get('account')).status()).toBe(200)
    await me.api.dispose()
  })

  test('organizers are pointed at support instead', async () => {
    const organizer = await signUpOrganizerViaApi()
    const res = await deleteAccount(organizer, { confirmation: 'DELETE', password: 'anything-at-all' })
    expect(res.status()).toBe(403)
    expect((await res.json()).error.message).toMatch(/support@munhub\.in/)
    expect(await (await organizer.api.get('auth/session')).json()).toMatchObject({ userId: organizer.userId })
    await organizer.api.dispose()
  })

  test('erases the person, keeps anonymous records, releases unpaid seats, and ends every session', async () => {
    const me = await signUpViaApi({ name: 'E2E Leaving Delegate' })
    const secondDevice = await signInViaApi(me.email, me.password)
    const paid = await registerOnOpenMun(me, { pay: true })
    // A second, unpaid hold on another pass.
    const unpaid = await registerOnOpenMun(me, { pass: OPEN.products[1].name })
    expect(await registrationStatus(unpaid)).toMatch(/PENDING/)

    const res = await deleteAccount(me, { confirmation: 'DELETE', password: me.password })
    expect(res.status()).toBe(204)
    expect(res.headers()['set-cookie'] ?? '').toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)

    // Signed out everywhere.
    expect(await (await me.api.get('auth/session')).json()).toBeNull()
    expect(await (await secondDevice.api.get('auth/session')).json()).toBeNull()
    const login = await newApiContext()
    expect((await login.post('auth/session', { data: { email: me.email, password: me.password } })).status()).toBe(401)

    // The person is gone; the records stay, without them.
    const row = await userRow(me.userId)
    expect(row.email).not.toBe(me.email)
    expect(row.email).toMatch(/@deleted\.invalid$/)
    expect(row.name).not.toContain('E2E Leaving Delegate')
    expect(row).toMatchObject({ phone: null, institution: null, password_hash: null, hasProfile: false })
    expect(await registrationStatus(paid)).toBe('CONFIRMED')
    expect(await registrationStatus(unpaid)).toBe('CANCELLED')

    // The address is free to sign up again, as a new account.
    const again = await login.post('auth/users', { data: signUpPayload({ email: me.email }) })
    expect(again.status(), await again.text()).toBe(201)
    expect((await again.json()).userId).not.toBe(me.userId)
    await login.dispose()
    await me.api.dispose()
    await secondDevice.api.dispose()
  })
})

test.describe('privacy & data — profile page', () => {
  async function openProfile(page: Page) {
    await page.goto('/profile')
    const section = page.getByRole('region', { name: 'Privacy & data' })
    await section.scrollIntoViewIfNeeded()
    await expect(section).toBeVisible()
    return section
  }

  test('"Download my data" saves a JSON file of the account', async ({ browser }) => {
    const me = await signUpViaApi({ name: 'E2E Download Me' })
    const context = await browserContextFor(browser, me)
    const page = await context.newPage()
    const crashes = watchForCrashes(page)
    const section = await openProfile(page)
    await expect(section.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: 'Download my data' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^munhub-data-\d{4}-\d{2}-\d{2}\.json$/)
    const data = JSON.parse(await readFile((await download.path())!, 'utf8')) as ExportData
    expect(data.account).toMatchObject({ id: me.userId, email: me.email, name: 'E2E Download Me' })
    await expect(page.getByText('Your data is downloading')).toBeVisible()
    crashes.assertNone()
    await context.close()
  })

  test('deleting the account needs DELETE and the password, then signs the delegate out', async ({ browser }) => {
    const me = await signUpViaApi()
    const context = await browserContextFor(browser, me)
    const page = await context.newPage()
    const section = await openProfile(page)
    await expect(section).toContainText('Payments are not refunded')

    await section.getByRole('button', { name: 'Delete my account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Delete my account' })
    await expect(confirm).toBeDisabled()

    await dialog.getByLabel(/to confirm/).fill('delete')
    await dialog.getByLabel('Password').fill(me.password)
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/to confirm/).fill('DELETE')
    await expect(confirm).toBeEnabled()

    // A wrong password is refused and the dialog stays open.
    await dialog.getByLabel('Password').fill('not-my-password')
    await confirm.click()
    await expect(page.getByText('Password is incorrect')).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(await (await me.api.get('auth/session')).json()).not.toBeNull()

    // Cancel closes it without doing anything.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await section.getByRole('button', { name: 'Delete my account' }).click()
    await expect(dialog.getByLabel(/to confirm/)).toHaveValue('')

    await dialog.getByLabel(/to confirm/).fill('DELETE')
    await dialog.getByLabel('Password').fill(me.password)
    await dialog.getByRole('button', { name: 'Delete my account' }).click()
    await expect(page.getByText('Your account has been deleted')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: /account menu/i })).toHaveCount(0)

    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprofile$/)
    await context.close()
  })

  test('the section reads well on a phone', async ({ browser }) => {
    const me = await signUpViaApi()
    const context = await browserContextFor(browser, me)
    const page = await context.newPage()
    await page.setViewportSize({ width: 375, height: 800 })
    await openProfile(page)
    await expect(pageHeading(page)).toBeVisible()
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
    await context.close()
  })
})
