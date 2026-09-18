import { expect, test, type Locator, type Page } from '@playwright/test'
import { adminApi, fixtureOwnerApi } from '../admin/_helpers'
import { getMun } from '../../fixtures/api'
import { PRICING } from '../../fixtures/fixture-muns'
import { expectedFeeSplit, registerForPass } from '../../fixtures/payments'
import { expireSeatHold, paymentFor, recreatePricingMun } from '../../fixtures/payments-fixture-db'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { freshStudentPage, main } from './_helpers'

/**
 * Delegate-facing payments (lane `payments`): early-bird pricing on the MUN
 * page and in the funnel, the platform-fee split stored with each payment,
 * resuming an unpaid registration from the dashboard, and the receipt.
 *
 * Runs on the pricing fixture (FIXTURE_MUNS.pricing), recreated before this
 * file so it starts with no registrations.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const [EARLY, LATE, ODD] = PRICING.products
const COMMITTEE = PRICING.committees[0]

test.beforeAll(async () => {
  await recreatePricingMun()
})

function rupees(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

/** A pass card on the MUN page: the h3 with the pass name sits directly in the card. */
function passCard(page: Page, name: string): Locator {
  return main(page).getByRole('heading', { level: 3, name, exact: true }).locator('xpath=..')
}

function registrationCard(page: Page) {
  return main(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: PRICING.name, exact: true }) })
}

function reviewValue(page: Page, term: string) {
  return main(page).locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]')
}

const EARLY_BIRD_LINE = /Early-bird price until \d{1,2} \w+ \d{4}/

test.describe('early-bird pricing', () => {
  test('the MUN page shows the early-bird price only while it is running and cheaper', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto(`/mun/${PRICING.slug}`)
    await expect(pageHeading(page)).toHaveText(PRICING.name)

    const early = passCard(page, EARLY.name)
    await expect(early).toContainText(rupees(EARLY.earlyBird.price))
    await expect(early.getByRole('deletion')).toHaveText(`Regular price ${rupees(EARLY.price)}`)
    await expect(early).toContainText(EARLY_BIRD_LINE)

    for (const pass of [LATE, ODD]) {
      const card = passCard(page, pass.name)
      await expect(card).toContainText(rupees(pass.price))
      await expect(card).not.toContainText(rupees(pass.earlyBird.price))
      await expect(card.getByRole('deletion')).toHaveCount(0)
      await expect(card).not.toContainText(/early-bird/i)
    }
    crashes.assertNone()
  })

  test('the funnel charges the early-bird price, end to end', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    await page.goto(`/register/${PRICING.slug}`)

    const options = main(page).getByRole('group', { name: /registration option/i })
    const earlyRadio = page.getByRole('radio', { name: new RegExp(EARLY.name) })
    const earlyOption = options.locator(earlyRadio)
    await expect(earlyOption).toBeVisible()
    const earlyLabel = options.locator('label').filter({ has: earlyRadio })
    await expect(earlyLabel.getByRole('deletion')).toHaveText(`Regular price ${rupees(EARLY.price)}`)
    await expect(earlyLabel).toContainText(rupees(EARLY.earlyBird.price))
    await expect(earlyLabel).toContainText(EARLY_BIRD_LINE)
    const lateLabel = options.locator('label').filter({ has: page.getByRole('radio', { name: new RegExp(LATE.name) }) })
    await expect(lateLabel).toContainText(rupees(LATE.price))
    await expect(lateLabel.getByRole('deletion')).toHaveCount(0)

    await earlyOption.check()
    await main(page).getByRole('combobox', { name: /committee/i }).selectOption({ label: COMMITTEE.name })
    await main(page).getByRole('button', { name: /continue to details/i }).click()
    await expect(main(page).getByRole('heading', { name: /delegate details/i })).toBeVisible()
    await main(page).getByRole('button', { name: /^review$/i }).click()
    await expect(main(page).getByRole('heading', { name: /review and confirm/i })).toBeVisible()
    await expect(reviewValue(page, 'Price')).toHaveText(`${rupees(EARLY.earlyBird.price)} (early bird)`)
    await expect(main(page)).toContainText('All payments are final')

    // Additive fee model (docs/payments/SPEC.md §4.4): every amount shown at
    // and after checkout is the total charged (listed price + platform fee +
    // GST on the fee), not the listed price alone.
    const split = expectedFeeSplit(EARLY.earlyBird.price)

    await main(page).getByRole('button', { name: /confirm and pay/i }).click()
    await expect(page).toHaveURL(/\/pay\?registrationId=/)
    const registrationId = new URL(page.url()).searchParams.get('registrationId')!
    await expect(main(page)).toContainText(`Amount due${rupees(split.totalCharge)}`)
    await expect(main(page)).toContainText("Includes MUN Hub's platform fee (incl. GST), itemized on your receipt.")
    await main(page).getByRole('button', { name: `Pay ${rupees(split.totalCharge)}` }).click()

    await expect(page).toHaveURL(/\/confirmation\?registrationId=/)
    await expect(main(page)).toContainText(/you're registered/i)
    await expect(reviewValue(page, 'Amount')).toHaveText(rupees(split.totalCharge))

    // Stored with the fee split the API is configured for.
    const payment = await paymentFor(registrationId)
    expect(payment).toMatchObject({
      status: 'PAID',
      amount: split.totalCharge,
      currency: 'INR',
      platformFeeAmount: split.platformFee,
      platformFeeTaxAmount: split.platformFeeTax,
      organizerNetAmount: split.organizerNet,
    })
    expect(payment!.platformFeeAmount! + payment!.platformFeeTaxAmount! + payment!.organizerNetAmount!).toBe(payment!.amount)

    await main(page).getByRole('button', { name: 'View receipt' }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/registrations/${registrationId}/receipt$`))
    await expect(main(page)).toContainText(`Amount paid${rupees(split.totalCharge)}`)
    expect((await session.api.get(`registrations/${registrationId}`)).ok()).toBe(true)
    crashes.assertNone()
    await context.close()
  })

  test('the server decides the price: regular after the deadline, and a dearer "early bird" is ignored', async ({ browser }) => {
    const { context, session } = await freshStudentPage(browser)
    const mun = await getMun(session.api, PRICING.slug)
    const byName = (name: string) => mun.registrationProducts.find((p) => p.name === name) as unknown as {
      price: number
      earlyBirdPrice: number | null
      earlyBirdDeadline: string | null
    }
    expect(byName(EARLY.name)).toMatchObject({ price: EARLY.price, earlyBirdPrice: EARLY.earlyBird.price })
    expect(new Date(byName(EARLY.name).earlyBirdDeadline!).getTime()).toBeGreaterThan(Date.now())
    expect(new Date(byName(LATE.name).earlyBirdDeadline!).getTime()).toBeLessThan(Date.now())

    for (const pass of [LATE, ODD] as const) {
      // Additive fee model: the stored/displayed amount is totalCharge, not
      // the listed price alone (docs/payments/SPEC.md §4.4).
      const charged = expectedFeeSplit(pass.price).totalCharge
      const registrationId = await registerForPass(session, PRICING.slug, pass.name)
      expect((await paymentFor(registrationId))?.amount, pass.name).toBe(charged)
      const detail = await (await session.api.get(`registrations/${registrationId}`)).json()
      expect(detail.payment).toEqual([{ amount: charged, currency: 'INR', status: 'PENDING' }])
    }
    await context.close()
  })
})

test.describe('resuming a payment', () => {
  test('"Complete payment" on the dashboard takes the delegate back to pay for a held seat', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const registrationId = await registerForPass(session, PRICING.slug, EARLY.name)
    // Additive fee model: the amount shown throughout is totalCharge.
    const totalCharge = expectedFeeSplit(EARLY.earlyBird.price).totalCharge

    await page.goto('/dashboard')
    const card = registrationCard(page)
    await expect(card).toContainText('Payment pending')
    await expect(card.getByRole('link', { name: /receipt/i })).toHaveCount(0)
    await card.getByRole('button', { name: 'Complete payment' }).click()

    await expect(page).toHaveURL(new RegExp(`/register/${PRICING.slug}/pay\\?registrationId=${registrationId}$`))
    await expect(pageHeading(page)).toHaveText('Complete your payment')
    await main(page).getByRole('button', { name: `Pay ${rupees(totalCharge)}` }).click()
    await expect(main(page)).toContainText(/you're registered/i)

    await page.goto('/dashboard')
    await expect(card).toContainText('Confirmed')
    await expect(card).toContainText(rupees(totalCharge))
    await expect(card.getByRole('button', { name: 'Complete payment' })).toHaveCount(0)
    await card.getByRole('link', { name: `Receipt for ${PRICING.name}` }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/registrations/${registrationId}/receipt$`))
    await context.close()
  })

  test('a seat whose hold has lapsed is no longer offered for payment', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const registrationId = await registerForPass(session, PRICING.slug, EARLY.name)
    await expireSeatHold(registrationId)
    await page.goto('/dashboard')
    await expect(pageHeading(page)).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Complete payment' })).toHaveCount(0)
    await context.close()
  })
})

test.describe('receipt', () => {
  test('shows what was paid, the references, and no refund language', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    const registrationId = await registerForPass(session, PRICING.slug, LATE.name, { pay: 'success', committee: COMMITTEE.name })
    const payment = await paymentFor(registrationId)
    // Additive fee model: the amount shown/stored is totalCharge.
    const totalCharge = expectedFeeSplit(LATE.price).totalCharge

    await page.goto(`/dashboard/registrations/${registrationId}/receipt`)
    await expect(pageHeading(page)).toHaveText(PRICING.name)
    await expect(main(page)).toContainText('Registration receipt')
    await expect(main(page).getByRole('heading', { name: 'Amount paid' })).toBeVisible()
    await expect(main(page)).toContainText(`Amount paid${rupees(totalCharge)}`)
    await expect(main(page)).toContainText("Includes MUN Hub's platform fee (incl. GST), charged on top of the registration price.")
    await expect(main(page).getByRole('link', { name: 'All payments are final' })).toBeVisible()
    await expect(main(page)).not.toContainText(/refund/i)

    const row = (term: string) => reviewValue(page, term)
    await expect(row('Registration status')).toHaveText('Confirmed')
    await expect(row('Pass')).toHaveText(LATE.name)
    await expect(row('Committee')).toHaveText(COMMITTEE.name)
    await expect(row('Payment status')).toHaveText('Paid')
    await expect(row('Paid on')).toBeVisible()
    await expect(row('Payment reference')).toHaveText(payment!.providerPaymentId!)
    await expect(row('Order reference')).toHaveText(payment!.providerOrderId)
    await expect(row('Registration ID')).toHaveText(registrationId)
    // The fee split is not shown to delegates.
    await expect(main(page)).not.toContainText(/organizer net|GST on fee/i)
    await expect(main(page).getByRole('button', { name: 'Print' })).toBeVisible()

    const receipt = await (await session.api.get(`registrations/${registrationId}/receipt`)).json()
    expect(receipt).toMatchObject({
      registrationId,
      status: 'CONFIRMED',
      passName: LATE.name,
      payment: { amount: totalCharge, currency: 'INR', status: 'PAID', reference: payment!.providerPaymentId, orderId: payment!.providerOrderId },
    })
    expect(JSON.stringify(receipt)).not.toMatch(/platformFee|organizerNet|refund/i)

    await main(page).getByRole('link', { name: 'Contact support' }).click()
    await expect(page).toHaveURL(/\/support\/new$/)
    crashes.assertNone()
    await context.close()
  })

  test('only the delegate who registered can open the receipt', async ({ browser }) => {
    const owner = await freshStudentPage(browser)
    const registrationId = await registerForPass(owner.session, PRICING.slug, LATE.name, { pay: 'success' })
    await owner.context.close()

    const other = await freshStudentPage(browser)
    await other.page.goto(`/dashboard/registrations/${registrationId}/receipt`)
    await expect(pageHeading(other.page)).toHaveText(/couldn't find/i)
    await expect(other.page.getByRole('main')).not.toContainText(PRICING.name)
    expect((await other.session.api.get(`registrations/${registrationId}/receipt`)).status()).toBe(404)
    await other.context.close()

    // Not even the organizer or an admin gets someone's receipt.
    const admin = await adminApi()
    expect((await admin.get(`registrations/${registrationId}/receipt`)).status()).toBe(404)
    await admin.dispose()
    const organizer = await fixtureOwnerApi()
    expect((await organizer.get(`registrations/${registrationId}/receipt`)).status()).toBe(404)
    await organizer.dispose()

    // Signed out: sign in first.
    const anonContext = await browser.newContext()
    const anon = await anonContext.newPage()
    await anon.goto(`/dashboard/registrations/${registrationId}/receipt`)
    await expect(anon).toHaveURL(/\/login\?redirectTo=/)
    await anonContext.close()
  })
})
