import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { adminApi } from '../admin/_helpers'
import { getMun, signUpViaApi } from '../../fixtures/api'
import { PRICING } from '../../fixtures/fixture-muns'
import { expectedFeeSplit, registerForPass } from '../../fixtures/payments'
import { expireSeatHold, paymentFor, recreatePricingMun } from '../../fixtures/payments-fixture-db'
import { watchForCrashes } from '../../fixtures/ui'
import {
  anonApi,
  createFreshOrganizer,
  main,
  openSection,
  organizerApi,
  sandboxId,
  toast,
  uid,
} from './_helpers'

function inr(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

/**
 * Payments & Finance — the Payment Settlement module. Bank details are
 * write-only: once saved, only a masked last-4 may ever come back.
 * Sandbox only.
 */

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  await api?.dispose()
})

/** A fresh, unique PAN / account number per run so a leak can't be masked by an older value. */
function secrets() {
  const digits = String(Date.now()).slice(-8)
  return {
    pan: `ABCDE${digits.slice(0, 4)}F`,
    accountNumber: `50100${digits}`,
  }
}

function settlementPayload(pan: string, accountNumber: string, overrides: Record<string, unknown> = {}) {
  return {
    legalName: 'E2E Sandbox Society',
    orgType: 'Society',
    addressLine1: '1 Test Street',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    pan,
    authorizedRepName: 'E2E Treasurer',
    authorizedRepEmail: 'treasurer@example.com',
    accountHolderName: 'E2E Sandbox Society',
    bankName: 'E2E Test Bank',
    accountNumber,
    ifsc: 'E2EB0001234',
    accountType: 'Current',
    gateway: 'Razorpay',
    ...overrides,
  }
}

async function openFinance(page: Page) {
  await openSection(page, munId, 'finance', 'Payments & Finance')
}

test.describe('settlement settings UI', () => {
  test('save bank details; afterwards only the last four digits are ever shown', async ({ page }) => {
    const { pan, accountNumber } = secrets()
    const bankName = `E2E Bank ${uid()}`
    await openFinance(page)
    const form = main(page).locator('form')

    await form.getByLabel('Legal name').fill('E2E Sandbox Society')
    await form.getByLabel('Organization type').selectOption('Society')
    await form.getByLabel('Address line 1').fill('1 Test Street')
    await form.getByLabel('City').fill('Hyderabad')
    await form.getByLabel('State').fill('Telangana')
    await form.getByLabel('Postal code').fill('500001')
    await form.getByLabel('Full name').fill('E2E Treasurer')
    await form.getByLabel('Email').fill('treasurer@example.com')
    await form.getByLabel('PAN', { exact: true }).fill(pan.toLowerCase())
    await expect(form.getByLabel('PAN', { exact: true })).toHaveValue(pan)
    await form.getByLabel('Account holder name').fill('E2E Sandbox Society')
    await form.getByLabel('Bank name').fill(bankName)
    await form.getByLabel('Account number').fill(accountNumber)
    await form.getByLabel('IFSC').fill('e2eb0001234')
    await form.getByLabel('Account type').selectOption('Current')
    await form.getByRole('button', { name: 'Save settlement settings' }).click()
    await expect(toast(page, 'Settlement settings saved')).toBeVisible()

    const summary = main(page).getByRole('heading', { name: bankName })
    await expect(summary).toBeVisible()
    await expect(main(page)).toContainText(`Account ending ${accountNumber.slice(-4)}`)
    await expect(main(page)).toContainText(`PAN ending ${pan.slice(-4)}`)
    // The secret inputs are cleared, and only hint at what is on file.
    await expect(form.getByLabel('PAN', { exact: true })).toHaveValue('')
    await expect(form.getByLabel('Account number')).toHaveValue('')
    await expect(form.getByLabel('Account number')).toHaveAttribute('placeholder', `Ending in ${accountNumber.slice(-4)}`)
    await expect(main(page)).not.toContainText(accountNumber)
    await expect(main(page)).not.toContainText(pan)

    await page.reload()
    await expect(main(page).getByRole('heading', { name: bankName })).toBeVisible()
    await expect(main(page)).toContainText(`Currently on file: PAN ending ${pan.slice(-4)}, account ending ${accountNumber.slice(-4)}.`)
    await expect(form.getByLabel('Legal name')).toHaveValue('E2E Sandbox Society')
    await expect(form.getByLabel('PAN', { exact: true })).toHaveValue('')
    expect(await page.content()).not.toContain(accountNumber)
    expect(await page.content()).not.toContain(pan)
  })

  test('updating settings requires re-entering the PAN and account number', async ({ page }) => {
    const { pan, accountNumber } = secrets()
    expect((await api.put(`muns/${munId}/payment-settings`, { data: settlementPayload(pan, accountNumber) })).status()).toBe(200)
    await openFinance(page)
    const form = main(page).locator('form')
    await expect(form.getByLabel('Legal name')).toHaveValue('E2E Sandbox Society')
    await form.evaluate((el) => el.setAttribute('novalidate', ''))
    await form.getByRole('button', { name: 'Save settlement settings' }).click()
    await expect(toast(page, 'PAN is required')).toBeVisible()
    await form.getByLabel('PAN', { exact: true }).fill(pan)
    await form.getByRole('button', { name: 'Save settlement settings' }).click()
    await expect(toast(page, 'Account number is required')).toBeVisible()
  })

  test('the form has no refund policy (there are no refunds), and the API refuses one', async ({ page }) => {
    await openFinance(page)
    await expect(main(page).locator('form')).toBeVisible()
    await expect(main(page).getByLabel(/refund/i)).toHaveCount(0)
    await expect(main(page)).not.toContainText(/refund/i)
    const { pan, accountNumber } = secrets()
    const res = await api.put(`muns/${munId}/payment-settings`, {
      data: settlementPayload(pan, accountNumber, { refundPolicy: 'Full refund up to 14 days before' }),
    })
    expect(res.status()).toBe(400)
    expect(await (await api.get(`muns/${munId}/payment-settings`)).json()).not.toHaveProperty('refundPolicy')
  })
})

test.describe('payments summary', () => {
  /*
   * Paid money on the pricing fixture MUN, recreated here so the totals start
   * from zero: two paid registrations count; a pending one, a failed one and a
   * payment that arrived after its hold lapsed (an exception, the seat
   * released) don't.
   */
  const [EARLY, LATE] = PRICING.products
  const paidAmounts = [EARLY.earlyBird.price, LATE.price]
  let pricingMunId: string

  function stat(page: Page, label: string) {
    return main(page).locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
  }

  test.beforeAll(async () => {
    pricingMunId = await recreatePricingMun()
    const paidEarly = await signUpViaApi()
    await registerForPass(paidEarly, PRICING.slug, EARLY.name, { pay: 'success' })
    const paidLate = await signUpViaApi()
    await registerForPass(paidLate, PRICING.slug, LATE.name, { pay: 'success' })
    const pending = await signUpViaApi()
    await registerForPass(pending, PRICING.slug, LATE.name)
    const failed = await signUpViaApi()
    await registerForPass(failed, PRICING.slug, LATE.name, { pay: 'failure' })

    const late = await signUpViaApi()
    const lateId = await registerForPass(late, PRICING.slug, EARLY.name)
    await expireSeatHold(lateId)
    // An availability read sweeps the lapsed hold.
    const mun = await getMun(late.api, PRICING.slug)
    await late.api.get(`products/availability?ids=${mun.registrationProducts.map((p) => p.id).join(',')}`)
    const pay = await late.api.post(`registrations/${lateId}/mock-payment`, { data: { outcome: 'success' } })
    expect(await pay.json()).toEqual({ ok: true, exception: true })
    const payment = await paymentFor(lateId)
    const admin = await adminApi()
    await admin.post(`admin/payment-exceptions/${payment!.id}/resolve`, { data: { note: 'Returned (E2E finance fixture)' } })
    await admin.dispose()
  })

  function expectedTotals() {
    const splits = paidAmounts.map((amount) => expectedFeeSplit(amount))
    const sum = (pick: (s: ReturnType<typeof expectedFeeSplit>) => number) => splits.reduce((total, s) => total + pick(s), 0)
    return {
      currency: 'INR',
      grossCollected: paidAmounts.reduce((a, b) => a + b, 0),
      platformFee: sum((s) => s.platformFee),
      platformFeeTax: sum((s) => s.platformFeeTax),
      organizerNet: sum((s) => s.organizerNet),
      paidRegistrations: paidAmounts.length,
    }
  }

  test('the API totals paid, standing registrations with the platform fee split', async () => {
    const res = await api.get(`muns/${pricingMunId}/payments-summary`)
    expect(res.status(), await res.text()).toBe(200)
    const { totals } = await res.json()
    const expected = expectedTotals()
    expect(totals).toEqual([expected])
    expect(expected.platformFee + expected.platformFeeTax + expected.organizerNet).toBe(expected.grossCollected)
  })

  test('the finance page shows collected, fee, GST and net, matching the API', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const { totals } = await (await api.get(`muns/${pricingMunId}/payments-summary`)).json()
    const summary = totals[0]
    await openSection(page, pricingMunId, 'finance', 'Payments & Finance')
    await expect(main(page).getByText('Payments summary', { exact: true })).toBeVisible()
    await expect(stat(page, 'Gross collected')).toHaveText(inr(summary.grossCollected))
    await expect(stat(page, 'Platform fee')).toHaveText(inr(summary.platformFee))
    await expect(stat(page, 'GST on fee')).toHaveText(inr(summary.platformFeeTax))
    await expect(stat(page, 'Your net')).toHaveText(inr(summary.organizerNet))
    await expect(stat(page, 'Paid registrations')).toHaveText(String(summary.paidRegistrations))
    await expect(main(page)).not.toContainText(/refund/i)
    crashes.assertNone()
  })

  test('a MUN with no payments shows zeros', async ({ page }) => {
    await openFinance(page)
    await expect(stat(page, 'Gross collected')).toHaveText(inr(0))
    await expect(stat(page, 'Paid registrations')).toHaveText('0')
  })

  test('only the owner and staff can read the summary', async () => {
    const anon = await anonApi()
    expect((await anon.get(`muns/${pricingMunId}/payments-summary`)).status()).toBe(401)
    await anon.dispose()
    const delegate = await signUpViaApi()
    expect((await delegate.api.get(`muns/${pricingMunId}/payments-summary`)).status()).toBe(403)
    const stranger = await createFreshOrganizer('E2E Finance Stranger')
    expect((await stranger.api.get(`muns/${pricingMunId}/payments-summary`)).status()).toBe(403)
    await stranger.api.dispose()
    const admin = await adminApi()
    expect((await admin.get(`muns/${pricingMunId}/payments-summary`)).status()).toBe(200)
    await admin.dispose()
  })
})

test.describe('settlement settings API', () => {
  test('the API never returns the PAN or account number', async () => {
    const { pan, accountNumber } = secrets()
    const put = await api.put(`muns/${munId}/payment-settings`, { data: settlementPayload(pan, accountNumber) })
    expect(put.status(), await put.text()).toBe(200)
    const putText = await put.text()
    expect(putText).not.toContain(accountNumber)
    expect(putText).not.toContain(pan)

    const get = await api.get(`muns/${munId}/payment-settings`)
    expect(get.status()).toBe(200)
    const body = await get.json()
    expect(body).toMatchObject({ panLast4: pan.slice(-4), accountNumberLast4: accountNumber.slice(-4), bankName: 'E2E Test Bank' })
    for (const key of ['pan', 'accountNumber', 'panCiphertext', 'accountNumberCiphertext']) {
      expect(body).not.toHaveProperty(key)
    }
    const getText = JSON.stringify(body)
    expect(getText).not.toContain(accountNumber)
    expect(getText).not.toContain(pan)
  })

  test('only the owner can read or write the settlement settings', async () => {
    const anon = await anonApi()
    expect((await anon.get(`muns/${munId}/payment-settings`)).status()).toBe(401)
    const { pan, accountNumber } = secrets()
    expect((await anon.put(`muns/${munId}/payment-settings`, { data: settlementPayload(pan, accountNumber) })).status()).toBe(401)
    await anon.dispose()
  })

  test('an organizer cannot mark their own bank details verified', async () => {
    const res = await api.post(`muns/${munId}/payment-settings/actions/set-verification-state`, { data: { state: 'VERIFIED' } })
    expect(res.status()).toBe(403)
    expect((await (await api.get(`muns/${munId}/payment-settings`)).json()).verificationState).not.toBe('VERIFIED')
  })

  test('incomplete or malformed settings are refused', async () => {
    const { pan, accountNumber } = secrets()
    for (const overrides of [{ pan: '' }, { accountNumber: '' }, { authorizedRepEmail: 'nope' }, { ifsc: '' }, { legalName: undefined }]) {
      const res = await api.put(`muns/${munId}/payment-settings`, { data: settlementPayload(pan, accountNumber, overrides) })
      expect(res.status(), JSON.stringify(overrides)).toBe(400)
    }
  })
})
