import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { browserContextFor, newApiContext, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { adminApi, createApplication, createOrganizer, main } from './_helpers'

/** Nobody but staff gets into the admin console — in the UI or at the API. */

const ADMIN_PAGES = [
  '/admin',
  '/admin/review',
  '/admin/verification',
  '/admin/go-live-queue',
  '/admin/registrations',
  '/admin/payments',
  '/admin/organizers',
  '/admin/support',
  '/admin/audit',
  '/admin/muns',
  '/admin/muns/00000000-0000-0000-0000-000000000000',
  '/admin/staff',
]

const ADMIN_READS = [
  'admin/overview',
  'admin/review-queue',
  'admin/module-review-queue',
  'admin/go-live-queue',
  'admin/registrations',
  'admin/payment-exceptions',
  'admin/organizers',
  'admin/support/tickets',
  'admin/support/unread-count',
  'admin/audit',
  'admin/audit/user/00000000-0000-0000-0000-000000000000',
  'admin/search/registrations?q=e2e',
  'admin/muns',
  'admin/muns/00000000-0000-0000-0000-000000000000',
  'admin/staff',
  'admin/analytics',
  'admin/go-live-queue/details',
]

async function expectRefused(api: APIRequestContext, allowed: number[]) {
  for (const path of ADMIN_READS) {
    const response = await api.get(path)
    expect(allowed, `GET ${path} returned ${response.status()}`).toContain(response.status())
  }
}

async function expectAccessDenied(page: Page) {
  for (const path of ADMIN_PAGES) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: 'Access denied' }), path).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
    await expect(main(page).getByRole('table')).toHaveCount(0)
    await expect(main(page).getByRole('button', { name: /review|suspend|publish|assign to me/i })).toHaveCount(0)
  }
}

async function nonStaffPage(browser: Browser, session: ApiSession) {
  const context = await browserContextFor(browser, session)
  return { context, page: await context.newPage() }
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('every admin page sends you to the staff sign-in', async ({ page }) => {
    for (const path of ADMIN_PAGES.concat('/admin/audit/user/some-id')) {
      await page.goto(path)
      await expect(page, path).toHaveURL(/\/admin\/login\?redirectTo=/, { timeout: 5_000 })
      expect(new URL(page.url()).searchParams.get('redirectTo')).toBe(path)
      await expect(page.getByRole('heading', { level: 1, name: 'Staff sign in' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
    }
  })

  test('no admin data renders for a signed-out visitor', async ({ page }) => {
    for (const path of ADMIN_PAGES) {
      await page.goto(path)
      // Signed-out visitors only ever see the staff sign-in form.
      await expect(page, path).toHaveURL(/\/admin\/login\?redirectTo=/, { timeout: 5_000 })
      await expect(page.getByRole('heading', { level: 1, name: 'Staff sign in' })).toBeVisible()
      await expect(main(page).getByRole('table'), path).toHaveCount(0)
      await expect(main(page).getByRole('link', { name: /^Pending Applications/ })).toHaveCount(0)
      await expect(main(page).getByRole('button', { name: /^(review|review module|suspend|publish|assign to me)$/i })).toHaveCount(0)
    }
  })

  test('admin API endpoints refuse anonymous callers', async () => {
    const api = await newApiContext()
    // go-live-queue has no requireAuth middleware and is refused by the role check (403) instead.
    await expectRefused(api, [401, 403])
    for (const path of ADMIN_READS.filter((p) => p !== 'admin/go-live-queue')) {
      expect((await api.get(path)).status(), path).toBe(401)
    }
  })
})

test.describe('a signed-in student', () => {
  test('is refused every admin page', async ({ browser }) => {
    const student = await signUpViaApi()
    const { context, page } = await nonStaffPage(browser, student)
    await expectAccessDenied(page)
    await context.close()
  })

  test('is refused every admin API read and cannot take admin actions', async () => {
    const student = await signUpViaApi()
    await expectRefused(student.api, [403])

    const app = await createApplication('E2E Admin Boundary')
    const decide = await student.api.post(`admin/muns/${app.munId}/review-application`, { data: { decision: 'APPROVED' } })
    expect(decide.status()).toBe(403)
    const target = await createOrganizer()
    const suspend = await student.api.post(`admin/organizers/${target.userId}/suspend`, { data: { reason: 'nope' } })
    expect(suspend.status()).toBe(403)

    const admin = await adminApi()
    expect(((await (await admin.get(`admin/muns/${app.munId}/review`)).json()) as { status: string }).status).toBe('SUBMITTED')
    expect((await target.api.get('organizer/workspace/overview')).status()).toBe(200)
  })
})

test.describe('a signed-in organizer', () => {
  test('is refused every admin page', async ({ browser }) => {
    const organizer = await createOrganizer()
    const { context, page } = await nonStaffPage(browser, organizer)
    await expectAccessDenied(page)
    await context.close()
  })

  test('is refused every admin API read and cannot approve their own application', async () => {
    const app = await createApplication('E2E Admin Boundary')
    await expectRefused(app.organizer.api, [403])

    const decide = await app.organizer.api.post(`admin/muns/${app.munId}/review-application`, {
      data: { decision: 'APPROVED' },
    })
    expect(decide.status()).toBe(403)
    const suspendSelf = await app.organizer.api.post(`admin/organizers/${app.organizer.userId}/suspend`, {
      data: { reason: 'self' },
    })
    expect(suspendSelf.status()).toBe(403)
    const ticketUpdate = await app.organizer.api.patch('admin/support/tickets/00000000-0000-0000-0000-000000000000', {
      data: { status: 'CLOSED' },
    })
    expect(ticketUpdate.status()).toBe(403)

    const admin = await adminApi()
    expect(((await (await admin.get(`admin/muns/${app.munId}/review`)).json()) as { status: string }).status).toBe('SUBMITTED')
  })
})
