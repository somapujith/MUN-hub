import { expect, test, type Page } from '@playwright/test'
import { browserContextFor, getMun, signUpViaApi } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'

/**
 * The core revenue flow (PRD §18-26): Option -> Details -> Review -> Pay ->
 * Confirmation -> Dashboard, against the E2E Open MUN fixture.
 *
 * Each test signs up its OWN fresh delegate through the real signup
 * endpoint, so tests never collide on the "one active registration per
 * pass per user" rule and every run starts from a known profile.
 *
 * Regression guard: before commit 2552682, "Confirm and pay" failed for
 * every student (dropped Content-Type) and the pay page rendered Not Found
 * (mock MUN lookup).
 */

const DELEGATE_PASS = OPEN.products[0] // E2E Delegate Pass, ₹1,499
const LIMITED_PASS = OPEN.products[1] // E2E Limited Pass, capacity 2
const RETIRED_PASS = OPEN.products[2] // inactive
const GA = OPEN.committees[0] // E2E General Assembly
const SC = OPEN.committees[1] // E2E Security Council

test.use({ storageState: { cookies: [], origins: [] } })

async function freshDelegatePage(browser: import('@playwright/test').Browser, overrides = {}) {
  const session = await signUpViaApi(overrides)
  const context = await browserContextFor(browser, session)
  const page = await context.newPage()
  return { session, context, page }
}

function main(page: Page) {
  return page.getByRole('main')
}

async function chooseOption(page: Page, passName: string, committee?: string, portfolio?: string) {
  await main(page).getByRole('radio', { name: new RegExp(passName) }).check()
  if (committee) {
    await main(page).getByRole('combobox', { name: /committee/i }).selectOption({ label: committee })
    if (portfolio) await main(page).getByRole('combobox', { name: /portfolio/i }).selectOption({ label: portfolio })
  }
  await main(page).getByRole('button', { name: /continue to details/i }).click()
  await expect(main(page).getByRole('heading', { name: /delegate details/i })).toBeVisible()
}

async function continueToReview(page: Page) {
  await main(page).getByRole('button', { name: /^review$/i }).click()
  await expect(main(page).getByRole('heading', { name: /review and confirm/i })).toBeVisible()
}

async function confirmAndPay(page: Page) {
  await main(page).getByRole('button', { name: /confirm and pay/i }).click()
  await expect(page).toHaveURL(/\/register\/[^/]+\/pay\?registrationId=/)
  await expect(page.getByRole('heading', { level: 1, name: /complete your payment/i })).toBeVisible()
}

function reviewValue(page: Page, term: string) {
  return main(page).locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]')
}

test.describe('registration funnel — happy path', () => {
  test('a new delegate registers, pays, and sees the confirmed seat on their dashboard', async ({ browser }) => {
    const { context, page, session } = await freshDelegatePage(browser)
    const crashes = watchForCrashes(page)

    await page.goto(`/mun/${OPEN.slug}`)
    await expect(page.getByRole('heading', { level: 1, name: OPEN.name })).toBeVisible()
    await main(page).getByRole('button', { name: /register now/i }).click()
    await expect(page).toHaveURL(new RegExp(`/register/${OPEN.slug}$`))

    // Step 1 — Option
    await expect(main(page).getByRole('list', { name: /registration progress/i })).toContainText(/Option.*current step/)
    await chooseOption(page, DELEGATE_PASS.name, GA.name, GA.portfolios[0])

    // Step 2 — Details, pre-filled from the profile captured at signup
    // Arriving via the MUN page (mun + availability already cached) used to
    // mount the form before the profile loaded, leaving every field empty.
    await expect(page.locator('#fullName')).toHaveValue('E2E Delegate')
    await expect(page.locator('#email')).toHaveValue(session.email)
    await expect(page.locator('#phone')).toHaveValue('9876501234')
    await expect(page.locator('#grade_class')).toHaveValue('3rd year')
    await expect(page.locator('#residential_address')).toHaveValue('42 Test Lane, Hyderabad')
    await expect(page.locator('#date_of_birth')).toHaveValue('2004-06-15')
    await expect(page.locator('#emergency_contact_name')).toHaveValue('E2E Guardian')
    await expect(page.locator('#emergency_contact_phone')).toHaveValue('9876505678')
    await page.locator('#mun_experience').fill('Two conferences, one Best Delegate')
    await continueToReview(page)

    // Step 3 — Review shows everything that will be submitted
    await expect(reviewValue(page, 'Conference')).toHaveText(OPEN.name)
    await expect(reviewValue(page, 'Pass')).toHaveText(DELEGATE_PASS.name)
    await expect(reviewValue(page, 'Committee')).toHaveText(GA.name)
    await expect(reviewValue(page, 'Portfolio')).toHaveText(GA.portfolios[0])
    await expect(reviewValue(page, 'MUN experience')).toHaveText('Two conferences, one Best Delegate')

    // Pay — the server decides the amount, not the client
    await confirmAndPay(page)
    await expect(main(page)).toContainText('₹1,499')
    await expect(main(page)).toContainText(/reference/i)
    await main(page).getByRole('button', { name: /^pay /i }).click()

    // Confirmation
    await expect(page).toHaveURL(/\/register\/[^/]+\/confirmation\?registrationId=/)
    await expect(main(page)).toContainText(/you're registered/i)
    await expect(main(page)).toContainText(/confirmed/i)
    await expect(main(page)).toContainText(GA.name)
    await expect(main(page)).toContainText(GA.portfolios[0])

    // Dashboard shows the seat
    await page.goto('/dashboard')
    await expect(main(page)).toContainText(OPEN.name)
    await expect(main(page)).toContainText(/confirmed/i)

    crashes.assertNone()
    await context.close()
  })

  test('a failed payment releases the seat and offers a retry', async ({ browser }) => {
    const { context, page } = await freshDelegatePage(browser)

    await page.goto(`/register/${OPEN.slug}`)
    await chooseOption(page, DELEGATE_PASS.name)
    await continueToReview(page)
    await confirmAndPay(page)
    await main(page).getByRole('button', { name: /simulate failure/i }).click()

    await expect(page).toHaveURL(/confirmation\?registrationId=/)
    await expect(main(page)).toContainText(/payment didn't go through/i)
    await expect(main(page)).toContainText(/cancelled/i)
    await main(page).getByRole('button', { name: /try again/i }).click()
    await expect(page).toHaveURL(new RegExp(`/register/${OPEN.slug}$`))
    await context.close()
  })

  test('Back preserves what was entered on each step', async ({ browser }) => {
    const { context, page } = await freshDelegatePage(browser)

    await page.goto(`/register/${OPEN.slug}`)
    await chooseOption(page, DELEGATE_PASS.name, GA.name)
    await page.locator('#referral_code').fill('FRIEND-E2E')
    await continueToReview(page)
    await main(page).getByRole('button', { name: /^back$/i }).click()
    await expect(page.locator('#referral_code')).toHaveValue('FRIEND-E2E')
    await main(page).getByRole('button', { name: /^back$/i }).click()
    await expect(main(page).getByRole('combobox', { name: /committee/i })).toHaveValue(/.+/)
    await context.close()
  })
})

test.describe('registration funnel — options shown', () => {
  test('only active passes are offered, and portfolios wait for a committee', async ({ browser }) => {
    const { context, page } = await freshDelegatePage(browser)
    await page.goto(`/register/${OPEN.slug}`)

    const options = main(page).getByRole('group', { name: /registration option/i })
    await expect(options.getByRole('radio', { name: new RegExp(DELEGATE_PASS.name) })).toBeVisible()
    await expect(options.getByRole('radio', { name: new RegExp(LIMITED_PASS.name) })).toBeVisible()
    await expect(options.getByRole('radio', { name: new RegExp(RETIRED_PASS.name) })).toHaveCount(0)

    const portfolio = main(page).getByRole('combobox', { name: /portfolio/i })
    await expect(portfolio).toBeDisabled()
    await main(page).getByRole('combobox', { name: /committee/i }).selectOption({ label: SC.name })
    await expect(portfolio).toBeEnabled()
    for (const name of SC.portfolios) await expect(portfolio.getByRole('option', { name })).toHaveCount(1)
    // A portfolio from a different committee must not be offered.
    await expect(portfolio.getByRole('option', { name: GA.portfolios[0] })).toHaveCount(0)
    await context.close()
  })

  test('the registration page is gated behind sign-in and returns you to the MUN afterwards', async ({ page }) => {
    await page.goto(`/register/${OPEN.slug}`)
    await expect(page).toHaveURL(/\/login\?redirectTo=/)
    expect(decodeURIComponent(page.url())).toContain(`/register/${OPEN.slug}`)
  })
})

test.describe('registration funnel — server-side integrity', () => {
  test('the same delegate cannot hold two active seats on one pass', async ({ browser }) => {
    const { context, page, session } = await freshDelegatePage(browser)
    const mun = await getMun(session.api, OPEN.slug)
    const pass = mun.registrationProducts.find((p) => p.name === DELEGATE_PASS.name)!
    const first = await session.api.post('registrations', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { munId: mun.id, registrationProductId: pass.id },
    })
    expect(first.status()).toBe(201)

    await page.goto(`/register/${OPEN.slug}`)
    await chooseOption(page, DELEGATE_PASS.name)
    await continueToReview(page)
    await main(page).getByRole('button', { name: /confirm and pay/i }).click()
    await expect(main(page).getByRole('alert')).toContainText(/already have an active registration/i)
    await context.close()
  })

  test('a sold-out pass cannot be oversold', async () => {
    const probe = await signUpViaApi()
    const mun = await getMun(probe.api, OPEN.slug)
    const limited = mun.registrationProducts.find((p) => p.name === LIMITED_PASS.name)!
    const body = { munId: mun.id, registrationProductId: limited.id }

    // Seats may already be held by other tests in this run, so work from
    // what's actually left rather than assuming an empty pass.
    const availability = await (await probe.api.get(`products/availability?ids=${limited.id}`)).json()
    const remaining: number = availability.availability[limited.id].available

    const results: number[] = []
    for (let i = 0; i < remaining + 2; i += 1) {
      const delegate = await signUpViaApi()
      const res = await delegate.api.post('registrations', {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        data: body,
      })
      results.push(res.status())
      if (res.status() !== 201) {
        expect((await res.json()).error.message).toMatch(/at capacity/i)
      }
    }
    expect(results.filter((s) => s === 201)).toHaveLength(remaining)

    const after = await (await probe.api.get(`products/availability?ids=${limited.id}`)).json()
    expect(after.availability[limited.id].available).toBe(0)
  })

  test('concurrent delegates cannot oversell the last seats', async () => {
    const probe = await signUpViaApi()
    const mun = await getMun(probe.api, OPEN.slug)
    const limited = mun.registrationProducts.find((p) => p.name === LIMITED_PASS.name)!
    const delegates = await Promise.all(Array.from({ length: 6 }, () => signUpViaApi()))
    const statuses = await Promise.all(
      delegates.map((d) =>
        d.api
          .post('registrations', {
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            data: { munId: mun.id, registrationProductId: limited.id },
          })
          .then((r) => r.status()),
      ),
    )
    // The previous test may already have taken both seats; either way the
    // total confirmed-or-held count can never exceed capacity.
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(limited.capacity ?? 2)
  })

  test('the server rejects a registration payload with a price or status the client made up', async () => {
    const delegate = await signUpViaApi()
    const mun = await getMun(delegate.api, OPEN.slug)
    const pass = mun.registrationProducts.find((p) => p.name === DELEGATE_PASS.name)!
    const res = await delegate.api.post('registrations', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { munId: mun.id, registrationProductId: pass.id, price: 1, status: 'CONFIRMED', userId: 'someone-else' },
    })
    // Unknown fields are rejected outright by the strict schema.
    expect(res.status()).toBe(400)
  })

  test('validation failures come back in the standard error shape (not "Request failed")', async () => {
    const delegate = await signUpViaApi()
    const res = await delegate.api.post('registrations', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: {},
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.fields).toHaveProperty('munId')
  })
})
