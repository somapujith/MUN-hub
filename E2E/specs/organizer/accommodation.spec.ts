import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  acceptNextConfirm,
  anonApi,
  cardFor,
  expectWorkspaceBug,
  main,
  openSection,
  organizerApi,
  prepareWorkspace,
  sandboxId,
  toast,
  uid,
} from './_helpers'

/** Accommodation module — lodging/add-on options and their custom fields (Onboarding PRD). Sandbox only. */

const REGION = 'Accommodation options'

interface Option {
  id: string
  name: string
  price: number
  capacity: number
  description: string | null
  status: string
}

interface OptionField {
  id: string
  label: string
  fieldType: string
  required: boolean
  choices: string[] | null
}

let api: APIRequestContext
let munId: string
const created: string[] = []

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  // Archiving is the only delete there is; keep the sandbox's active list clean.
  for (const option of await listOptions(true)) {
    if (option.name.startsWith('E2E ') && option.status === 'active') await api.delete(`accommodation/${option.id}`)
  }
  await api?.dispose()
})

async function listOptions(includeInactive: boolean, context = api): Promise<Option[]> {
  const res = await context.get(`muns/${munId}/accommodation${includeInactive ? '?includeInactive=true' : ''}`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function createOption(data: Record<string, unknown>): Promise<Option> {
  const res = await api.post(`muns/${munId}/accommodation`, { data })
  expect(res.status(), await res.text()).toBe(201)
  const option: Option = await res.json()
  created.push(option.id)
  return option
}

async function openAccommodation(page: Page) {
  await prepareWorkspace(page, api)
  await openSection(page, munId, 'accommodation', 'Accommodation')
}

test.describe('accommodation UI', () => {
  test('add and edit an option, then archive and restore it', async ({ page }) => {
    expectWorkspaceBug()
    const name = `E2E Twin Room ${uid()}`
    await openAccommodation(page)

    await main(page).getByRole('button', { name: 'Add option' }).first().click()
    const form = main(page).locator('form')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Price (INR)').fill('3200')
    await form.getByLabel('Capacity').fill('40')
    await form.getByLabel('Description').fill('Two nights, breakfast included')
    await form.getByRole('button', { name: 'Add option' }).click()

    await expect(toast(page, 'Accommodation option added')).toBeVisible()
    const card = cardFor(page, REGION, name)
    await expect(card).toContainText('₹3,200 · Capacity 40')
    await expect(card).toContainText('Two nights, breakfast included')
    const saved = (await listOptions(true)).find((o) => o.name === name)!
    expect(saved).toMatchObject({ price: 3200, capacity: 40, status: 'active' })

    await main(page).getByRole('button', { name: `Edit ${name}` }).click()
    await expect(form.getByLabel('Price (INR)')).toHaveValue('3200')
    await form.getByLabel('Price (INR)').fill('2800')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Accommodation option updated')).toBeVisible()
    await expect(card).toContainText('₹2,800 · Capacity 40')

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Archive ${name}` }).click()
    await expect(card).toContainText('Archived')
    // Archived options stay visible to the organizer but not to delegates.
    const anon = await anonApi()
    expect((await listOptions(false, anon)).map((o) => o.id)).not.toContain(saved.id)
    expect((await listOptions(true, anon)).map((o) => o.id)).not.toContain(saved.id)

    await main(page).getByRole('button', { name: `Restore ${name}` }).click()
    await expect(card).not.toContainText('Archived')
    expect((await listOptions(false, anon)).map((o) => o.id)).toContain(saved.id)
    await anon.dispose()
  })

  test('manage an option\'s custom fields', async ({ page }) => {
    expectWorkspaceBug()
    const option = await createOption({ name: `E2E Dorm ${uid()}`, price: 1000, capacity: 20 })
    await openAccommodation(page)
    const card = cardFor(page, REGION, option.name)

    await card.getByRole('button', { name: 'Manage custom fields' }).click()
    await expect(card).toContainText('No custom fields')
    await card.getByRole('button', { name: 'Add field' }).click()
    await card.getByLabel('Label').fill('Room-mate preference')
    await card.getByLabel('Type').selectOption({ label: 'Dropdown' })
    await card.getByRole('button', { name: 'Add field' }).click()
    await expect(toast(page, 'Dropdown/checkbox fields need at least one choice')).toBeVisible()

    await card.getByLabel('Choices (comma separated)').fill('Same school, Anyone')
    await card.getByLabel('Required').check()
    await card.getByRole('button', { name: 'Add field' }).click()
    await expect(toast(page, 'Field added')).toBeVisible()
    await expect(card.getByRole('listitem').filter({ hasText: 'Room-mate preference' })).toContainText('(Dropdown, required)')

    const fields: OptionField[] = await (await api.get(`accommodation/${option.id}/fields`)).json()
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ fieldType: 'DROPDOWN', required: true, choices: ['Same school', 'Anyone'] })

    acceptNextConfirm(page)
    await card.getByRole('button', { name: 'Delete Room-mate preference' }).click()
    await expect(card).toContainText('No custom fields')
    await card.getByRole('button', { name: 'Hide custom fields' }).click()
    await expect(card.getByRole('button', { name: 'Manage custom fields' })).toBeVisible()
  })

  test('name, price and capacity are validated', async ({ page }) => {
    expectWorkspaceBug()
    await openAccommodation(page)
    await main(page).getByRole('button', { name: 'Add option' }).first().click()
    const form = main(page).locator('form')
    await form.evaluate((el) => el.setAttribute('novalidate', ''))
    await form.getByRole('button', { name: 'Add option' }).click()
    await expect(toast(page, 'Name is required')).toBeVisible()
    await form.getByLabel('Name').fill(`E2E Negative ${uid()}`)
    await form.getByLabel('Price (INR)').fill('-1')
    await form.getByRole('button', { name: 'Add option' }).click()
    await expect(toast(page, 'Price must be 0 or more and capacity at least 1')).toBeVisible()
  })
})

test.describe('accommodation API', () => {
  test('invalid options and fields are refused', async () => {
    for (const data of [
      { name: 'E2E x', price: -1, capacity: 1 },
      { name: 'E2E x', price: 1, capacity: 0 },
      { name: '', price: 1, capacity: 1 },
      { name: 'E2E x', price: 1.5, capacity: 1 },
    ]) {
      expect((await api.post(`muns/${munId}/accommodation`, { data })).status(), JSON.stringify(data)).toBe(400)
    }
    const option = await createOption({ name: `E2E Field Guard ${uid()}`, price: 0, capacity: 1 })
    expect((await api.post(`accommodation/${option.id}/fields`, { data: { fieldType: 'SLIDER', label: 'x' } })).status()).toBe(400)
    expect((await api.post(`accommodation/${option.id}/fields`, { data: { fieldType: 'TEXT', label: '' } })).status()).toBe(400)
  })

  test('a dropdown field without choices is a validation error, not a server error', async () => {
    test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: lib/actions/accommodation.ts throws "Field type DROPDOWN requires at least one choice", which server/middleware/error.ts does not map, so the API answers 500 instead of 400')
    const option = await createOption({ name: `E2E Choice Guard ${uid()}`, price: 0, capacity: 1 })
    const res = await api.post(`accommodation/${option.id}/fields`, { data: { fieldType: 'DROPDOWN', label: 'Pick one' } })
    expect(res.status()).toBe(400)
  })
})
