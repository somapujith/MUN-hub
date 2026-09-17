import { expect, test, type Page } from '@playwright/test'
import { OPEN } from '../../fixtures/fixture-muns'
import { accountMenuButton, expectSignedOutHeader, pageHeading, watchForCrashes } from '../../fixtures/ui'
import { freshStudentPage, main, registerOnOpenMun } from './_helpers'

/** Student dashboard (PRD §26): greeting, empty state, upcoming registrations, account menu. */

const GA = OPEN.committees[0]
const DELEGATE_PASS = OPEN.products[0]

test.use({ storageState: { cookies: [], origins: [] } })

function registrationCard(page: Page) {
  return main(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: OPEN.name }) })
}

function formatDay(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

test.describe('student dashboard — empty', () => {
  test('a new student sees an empty state that points to the marketplace', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    await page.goto('/dashboard')

    await expect(pageHeading(page)).toHaveText(/^Hello, /)
    await expect(main(page)).toContainText('No registrations yet')
    await expect(registrationCard(page)).toHaveCount(0)

    const browse = main(page).getByRole('button', { name: 'Browse MUNs' })
    await expect(browse).toHaveCount(2) // header action + empty-state CTA
    await browse.last().click()
    await expect(page).toHaveURL(/\/muns$/)
    crashes.assertNone()
    await context.close()
  })

  test('the greeting uses the signed-in student\'s own name and institution', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser, { name: 'Priyanka Rao', institution: 'E2E Greeting College' })
    await page.goto('/dashboard')
    await expect(pageHeading(page)).toHaveText('Hello, Priyanka')
    await expect(main(page)).toContainText('E2E Greeting College')
    await expect(main(page)).not.toContainText('VIT Vellore')
    await context.close()
  })
})

test.describe('student dashboard — registrations', () => {
  test('a paid registration shows the MUN, dates, location, seat, amount and confirmed status', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await registerOnOpenMun(session, { committee: GA.name, portfolio: GA.portfolios[1], pay: true })
    const mun = (await (await session.api.get(`muns/${OPEN.slug}`)).json()) as { startDate: string; endDate: string }

    await page.goto('/dashboard')
    await expect(main(page).getByRole('heading', { level: 2, name: 'Upcoming' })).toBeVisible()
    const card = registrationCard(page)
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(formatDay(mun.endDate))
    await expect(card).toContainText('Hyderabad, India')
    await expect(card).toContainText(GA.name)
    await expect(card).toContainText(GA.portfolios[1])
    await expect(card).toContainText('₹1,499')
    await expect(card).toContainText('Confirmed')
    await expect(card).toContainText('Paid')

    await card.getByRole('link', { name: OPEN.name }).click()
    await expect(page).toHaveURL(new RegExp(`/mun/${OPEN.slug}$`))
    await context.close()
  })

  test('an unpaid registration is shown as awaiting payment, not confirmed', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await registerOnOpenMun(session)

    await page.goto('/dashboard')
    const card = registrationCard(page)
    await expect(card).toContainText('Payment pending')
    await expect(card).not.toContainText('Confirmed')
    await expect(card).not.toContainText(/\bPaid\b/)
    await context.close()
  })

  test('a cancelled (failed-payment) registration does not appear as upcoming', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const id = await registerOnOpenMun(session)
    await session.api.post(`registrations/${id}/mock-payment`, { data: { outcome: 'failure' } })

    await page.goto('/dashboard')
    await expect(pageHeading(page)).toBeVisible()
    await expect(registrationCard(page)).toHaveCount(0)
    await context.close()
  })

  test('each card shows the registration type (PRD §26)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §26 asks the dashboard card to show the registration type / pass name')
    const { context, page, session } = await freshStudentPage(browser)
    await registerOnOpenMun(session, { pay: true })
    await page.goto('/dashboard')
    await expect(registrationCard(page)).toContainText(DELEGATE_PASS.name)
    await context.close()
  })

  test('each card shows a visible registration ID (PRD §26)', async ({ browser }) => {
    test.fixme(true, 'Not yet implemented: PRD §26 asks the dashboard card to show the registration ID')
    const { context, page, session } = await freshStudentPage(browser)
    const id = await registerOnOpenMun(session, { pay: true })
    await page.goto('/dashboard')
    await expect(registrationCard(page)).toContainText(id)
    await context.close()
  })
})

test.describe('student dashboard — account menu', () => {
  test('menu items go to the dashboard, registrations and profile', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    await page.goto('/muns')

    await accountMenuButton(page).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['Dashboard', 'My registrations', 'Profile & account', 'Sign out'])

    await menu.getByRole('menuitem', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(pageHeading(page)).toBeVisible()

    await page.goto('/muns')
    await accountMenuButton(page).click()
    await page.getByRole('menuitem', { name: 'My registrations' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await accountMenuButton(page).click()
    await page.getByRole('menuitem', { name: 'Profile & account' }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(pageHeading(page)).toHaveText(/profile/i)
    await context.close()
  })

  test('Sign out ends the session and protected pages then require sign-in', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await page.goto('/dashboard')
    await accountMenuButton(page).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expectSignedOutHeader(page)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?redirectTo=/)

    // The API context still holds the same token; the server must have revoked it.
    const whoami = await session.api.get('auth/session')
    expect(await whoami.json()).toBeNull()
    await context.close()
  })
})
