import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  anonApi,
  main,
  openSection,
  organizerApi,
  sandboxId,
  toast,
  uid,
} from './_helpers'

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

  test.fixme('shows payments collected, platform fees and settlements', async () => {
    // Organizer Dashboard PRD "Payments & Finance": the section only has the
    // settlement-settings form; no collected/fee/settlement figures exist.
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
