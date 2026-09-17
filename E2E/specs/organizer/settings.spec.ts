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

/** Settings — the Contact module (Onboarding PRD: official contact details). Sandbox only. */

interface Contact {
  officialEmail: string
  phone: string | null
  website: string | null
  socialLinks: Record<string, string> | null
  contactPersonName: string
  contactPersonRole: string | null
  contactPersonEmail: string
  contactPersonPhone: string | null
}

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  await api?.dispose()
})

async function contact(): Promise<Contact | null> {
  const res = await api.get(`muns/${munId}/contact`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function openSettings(page: Page) {
  await openSection(page, munId, 'settings', 'Settings')
}

test.describe('contact settings UI', () => {
  test('save the official contact details and see them again after reload', async ({ page }) => {
    const tag = uid()
    await openSettings(page)
    const form = main(page).locator('form')
    await form.getByLabel('Official email').fill(`secretariat-${tag}@example.com`)
    await form.getByLabel('Phone', { exact: true }).fill('9876500001')
    await form.getByLabel('Website').fill('https://example.com/e2e-sandbox')
    await form.getByLabel('Social link').fill('https://instagram.com/e2e_sandbox')
    await form.getByLabel('Contact person').fill(`E2E Secretary ${tag}`)
    await form.getByLabel('Role', { exact: true }).fill('Secretary-General')
    await form.getByLabel('Contact email').fill(`sg-${tag}@example.com`)
    await form.getByLabel('Contact phone').fill('9876500002')
    await form.getByRole('button', { name: 'Save contact info' }).click()
    await expect(toast(page, 'Contact info saved')).toBeVisible()

    expect(await contact()).toMatchObject({
      officialEmail: `secretariat-${tag}@example.com`,
      phone: '9876500001',
      website: 'https://example.com/e2e-sandbox',
      socialLinks: { primary: 'https://instagram.com/e2e_sandbox' },
      contactPersonName: `E2E Secretary ${tag}`,
      contactPersonRole: 'Secretary-General',
      contactPersonEmail: `sg-${tag}@example.com`,
      contactPersonPhone: '9876500002',
    })

    await page.reload()
    await expect(form.getByLabel('Official email')).toHaveValue(`secretariat-${tag}@example.com`)
    await expect(form.getByLabel('Contact person')).toHaveValue(`E2E Secretary ${tag}`)
    await expect(form.getByLabel('Social link')).toHaveValue('https://instagram.com/e2e_sandbox')
  })

  test('official email, contact name and contact email are required', async ({ page }) => {
    await openSettings(page)
    const form = main(page).locator('form')
    await form.evaluate((el) => el.setAttribute('novalidate', ''))
    const before = await contact()
    await form.getByLabel('Official email').fill('')
    await form.getByRole('button', { name: 'Save contact info' }).click()
    await expect(toast(page, 'Official email, contact name, and contact email are required')).toBeVisible()
    expect(await contact()).toEqual(before)
  })
})

test.describe('contact settings API', () => {
  test('upsert is owner-only to write, and private until the MUN is live', async () => {
    const tag = uid()
    const res = await api.put(`muns/${munId}/contact`, {
      data: { officialEmail: `api-${tag}@example.com`, contactPersonName: 'E2E API Contact', contactPersonEmail: `api-person-${tag}@example.com` },
    })
    expect(res.status()).toBe(200)

    const anon = await anonApi()
    // The sandbox isn't published, so its contact details stay private (b411b4b).
    expect((await anon.get(`muns/${munId}/contact`)).status()).toBe(404)
    expect((await (await api.get(`muns/${munId}/contact`)).json()).officialEmail).toBe(`api-${tag}@example.com`)
    const anonWrite = await anon.put(`muns/${munId}/contact`, {
      data: { officialEmail: 'x@example.com', contactPersonName: 'x', contactPersonEmail: 'x@example.com' },
    })
    expect(anonWrite.status()).toBe(401)
    await anon.dispose()
  })

  test('malformed contact details are refused', async () => {
    for (const data of [
      { officialEmail: 'not-an-email', contactPersonName: 'x', contactPersonEmail: 'x@example.com' },
      { officialEmail: 'x@example.com', contactPersonName: '', contactPersonEmail: 'x@example.com' },
      { officialEmail: 'x@example.com', contactPersonName: 'x', contactPersonEmail: 'nope' },
      { officialEmail: 'x@example.com', contactPersonName: 'x' },
    ]) {
      expect((await api.put(`muns/${munId}/contact`, { data })).status(), JSON.stringify(data)).toBe(400)
    }
  })
})
