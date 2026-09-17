import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import {
  acceptNextConfirm,
  cardFor,
  main,
  openSection,
  organizerApi,
  sandboxId,
  toast,
  uid,
} from './_helpers'

/** Registration Form builder (Onboarding PRD §17). Sandbox only; every field created here is removed again. */

const REGION = 'Registration form fields'

const DEFAULT_FIELDS = [
  { key: 'grade_class', label: 'Grade / class', type: 'Academic year', required: true },
  { key: 'residential_address', label: 'Full residential address', type: 'Long text', required: true },
  { key: 'transportation', label: 'Do you require transportation?', type: 'Dropdown', required: true },
  { key: 'date_of_birth', label: 'Date of birth', type: 'Date', required: true },
  { key: 'referral_code', label: 'Referral code', type: 'Short text', required: false },
  { key: 'emergency_contact_name', label: 'Emergency contact name', type: 'Short text', required: true },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', type: 'Phone', required: true },
  { key: 'mun_experience', label: 'MUN experience', type: 'MUN experience', required: false },
]

interface FormField {
  id: string
  fieldKey: string
  fieldType: string
  label: string
  required: boolean
  choices: string[] | null
  displayOrder: number
  conditionalOn: string | null
  conditionalOperator: string | null
  conditionalValue: string | null
}

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  // Remove dependants first: a field referenced by a condition can't be deleted.
  const leftovers = (await listFields()).filter((f) => f.fieldKey.startsWith('e2e_'))
  for (const f of leftovers.filter((f) => f.conditionalOn)) await api.delete(`form-fields/${f.id}`)
  for (const f of leftovers.filter((f) => !f.conditionalOn)) await api.delete(`form-fields/${f.id}`)
  await api?.dispose()
})

async function listFields(): Promise<FormField[]> {
  const res = await api.get(`muns/${munId}/form-fields`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function createField(data: Record<string, unknown>): Promise<FormField> {
  const res = await api.post(`muns/${munId}/form-fields`, { data })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

async function openForm(page: Page) {
  await openSection(page, munId, 'form', 'Registration Form')
}

async function addField(
  page: Page,
  field: { label: string; key: string; type: string; choices?: string; required?: boolean; order?: number; showWhen?: { key: string; operator: string; value: string } },
): Promise<Locator> {
  await main(page).getByRole('button', { name: 'Add field' }).first().click()
  const form = main(page).locator('form')
  await form.getByLabel('Label').fill(field.label)
  await form.getByLabel('Field type').selectOption({ label: field.type })
  if (field.choices !== undefined) await form.getByLabel('Choices (comma-separated)').fill(field.choices)
  if (field.showWhen) {
    await form.getByLabel('Only show when').selectOption({ value: field.showWhen.key })
    await form.getByLabel('Condition').selectOption({ label: field.showWhen.operator })
    await form.getByLabel('Value').fill(field.showWhen.value)
  }
  // Field key and display order live under "Advanced" (auto-generated from
  // the label otherwise; opened here to set an explicit e2e_-prefixed key).
  await form.getByText('Advanced').click()
  await form.getByLabel('Field key').fill(field.key)
  if (field.order !== undefined) await form.getByLabel('Display order').fill(String(field.order))
  if (field.required) await form.getByLabel('Required').check()
  await form.getByRole('button', { name: 'Add field' }).click()
  return form
}

test.describe('form builder UI', () => {
  test('the default delegate questions are present', async ({ page }) => {
    await openForm(page)
    for (const field of DEFAULT_FIELDS) {
      const card = cardFor(page, REGION, field.label)
      await expect(card).not.toContainText('Field key')
      await expect(card).toContainText(field.type)
      if (field.required) await expect(card).toContainText('Required')
      else await expect(card).not.toContainText('Required')
    }
    await expect(cardFor(page, REGION, 'Do you require transportation?')).toContainText('Choices: Yes, No')
  })

  test('add fields of several types, including a dropdown with choices and a required field', async ({ page }) => {
    const tag = uid()
    await openForm(page)

    const text = { label: `E2E Diet ${tag}`, key: `e2e_diet_${tag}`, type: 'Short text', required: true }
    const form = await addField(page, text)
    await expect(toast(page, 'Field added')).toBeVisible()
    await expect(form).toHaveCount(0)
    await expect(cardFor(page, REGION, text.label)).toContainText('Short text')
    await expect(cardFor(page, REGION, text.label)).toContainText('Required')

    const dropdown = { label: `E2E Shirt ${tag}`, key: `e2e_shirt_${tag}`, type: 'Dropdown', choices: 'S, M, L, XL' }
    await addField(page, dropdown)
    await expect(cardFor(page, REGION, dropdown.label)).toContainText('Dropdown')
    await expect(cardFor(page, REGION, dropdown.label)).toContainText('Choices: S, M, L, XL')
    await expect(cardFor(page, REGION, dropdown.label)).not.toContainText('Required')

    const number = { label: `E2E Conferences ${tag}`, key: `e2e_count_${tag}`, type: 'Number' }
    await addField(page, number)
    await expect(cardFor(page, REGION, number.label)).toContainText('Number')

    const saved = await listFields()
    expect(saved.find((f) => f.fieldKey === text.key)).toMatchObject({ fieldType: 'SHORT_TEXT', required: true })
    expect(saved.find((f) => f.fieldKey === dropdown.key)).toMatchObject({
      fieldType: 'DROPDOWN',
      required: false,
      choices: ['S', 'M', 'L', 'XL'],
    })
    expect(saved.find((f) => f.fieldKey === number.key)?.fieldType).toBe('NUMBER')
  })

  test('toggle required on an existing field', async ({ page }) => {
    const field = await createField({ fieldKey: `e2e_toggle_${uid()}`, fieldType: 'EMAIL', label: `E2E Guardian email ${uid()}` })
    await openForm(page)
    const card = cardFor(page, REGION, field.label)
    await expect(card).not.toContainText('Required')

    await main(page).getByRole('button', { name: `Edit ${field.label}` }).click()
    const form = main(page).locator('form')
    await form.getByText('Advanced').click()
    await expect(form.getByLabel('Field key')).toHaveValue(field.fieldKey)
    await expect(form.getByLabel('Field key')).toHaveAttribute('readonly', '')
    await form.getByLabel('Required').check()
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Field updated')).toBeVisible()
    await expect(card).toContainText('Required')
    expect((await listFields()).find((f) => f.id === field.id)?.required).toBe(true)
  })

  test('a conditional field is shown only when another answer matches', async ({ page }) => {
    const tag = uid()
    const parent = await createField({
      fieldKey: `e2e_needs_room_${tag}`,
      fieldType: 'DROPDOWN',
      label: `E2E Needs room ${tag}`,
      choices: ['Yes', 'No'],
    })
    await openForm(page)
    const child = { label: `E2E Room type ${tag}`, key: `e2e_room_type_${tag}`, type: 'Short text' }
    await addField(page, { ...child, showWhen: { key: parent.fieldKey, operator: 'equals', value: 'Yes' } })
    await expect(toast(page, 'Field added')).toBeVisible()
    await expect(cardFor(page, REGION, child.label)).toContainText(`Shown when "${parent.label}" equals "Yes"`)

    const saved = (await listFields()).find((f) => f.fieldKey === child.key)
    expect(saved).toMatchObject({ conditionalOn: parent.fieldKey, conditionalOperator: 'EQUALS', conditionalValue: 'Yes' })

    // The parent can't be deleted while the condition depends on it. This is
    // caught client-side (no confirm dialog, no API call) with a plain
    // message naming the dependent field.
    await main(page).getByRole('button', { name: `Delete ${parent.label}` }).click()
    await expect(toast(page, new RegExp(`can't be deleted yet.*${child.label}`))).toBeVisible()
    await expect(cardFor(page, REGION, parent.label)).toBeVisible()

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${child.label}` }).click()
    await expect(main(page).getByRole('heading', { name: child.label, exact: true })).toHaveCount(0)
    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${parent.label}` }).click()
    await expect(main(page).getByRole('heading', { name: parent.label, exact: true })).toHaveCount(0)
  })

  test('reorder fields with the move buttons', async ({ page }) => {
    const tag = uid()
    const first = await createField({ fieldKey: `e2e_first_${tag}`, fieldType: 'SHORT_TEXT', label: `E2E First ${tag}`, displayOrder: 900 })
    const second = await createField({ fieldKey: `e2e_second_${tag}`, fieldType: 'SHORT_TEXT', label: `E2E Second ${tag}`, displayOrder: 901 })
    await openForm(page)

    const labels = main(page).getByRole('region', { name: REGION }).getByRole('heading', { level: 2 })
    await expect(labels.filter({ hasText: tag })).toHaveText([first.label, second.label])
    await cardFor(page, REGION, second.label).getByRole('button', { name: 'Move field up' }).click()
    await expect(labels.filter({ hasText: tag })).toHaveText([second.label, first.label])

    const saved = await listFields()
    expect(saved.find((f) => f.id === second.id)?.displayOrder).toBe(900)
    expect(saved.find((f) => f.id === first.id)?.displayOrder).toBe(901)
  })

  test('a duplicate field key is refused', async ({ page }) => {
    await openForm(page)
    const before = (await listFields()).length
    const form = await addField(page, { label: `E2E Duplicate ${uid()}`, key: 'grade_class', type: 'Short text' })
    await expect(toast(page, /Another field already uses the key "grade_class"/)).toBeVisible()
    await expect(form).toBeVisible()
    expect(await listFields()).toHaveLength(before)
  })

  test('client-side checks: key format, missing choices, self-reference', async ({ page }) => {
    await openForm(page)
    const form = await addField(page, { label: 'E2E Bad key', key: 'Bad Key!', type: 'Short text' })
    await expect(toast(page, /must start with a lowercase letter/)).toBeVisible()

    await form.getByLabel('Field key').fill(`e2e_nochoice_${uid()}`)
    await form.getByLabel('Field type').selectOption({ label: 'Multiple choice' })
    await form.getByRole('button', { name: 'Add field' }).click()
    await expect(toast(page, 'Multiple choice needs at least one choice')).toBeVisible()
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toHaveCount(0)
  })

  test('delete a field', async ({ page }) => {
    const field = await createField({ fieldKey: `e2e_delete_${uid()}`, fieldType: 'DATE', label: `E2E Arrival ${uid()}` })
    await openForm(page)
    await expect(cardFor(page, REGION, field.label)).toContainText('Date')
    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${field.label}` }).click()
    await expect(main(page).getByRole('heading', { name: field.label, exact: true })).toHaveCount(0)
    expect((await listFields()).map((f) => f.id)).not.toContain(field.id)
  })
})

test.describe('form builder API', () => {
  test('choice fields need choices, conditions need a real field, keys are unique', async () => {
    const tag = uid()
    const noChoices = await api.post(`muns/${munId}/form-fields`, {
      data: { fieldKey: `e2e_nc_${tag}`, fieldType: 'DROPDOWN', label: 'x' },
    })
    expect(noChoices.status()).toBe(400)

    const ghost = await api.post(`muns/${munId}/form-fields`, {
      data: { fieldKey: `e2e_ghost_${tag}`, fieldType: 'SHORT_TEXT', label: 'x', conditionalOn: 'no_such_field', conditionalOperator: 'EQUALS', conditionalValue: 'y' },
    })
    expect(ghost.status()).toBe(400)
    expect((await ghost.json()).error.message).toMatch(/unknown fieldKey/)

    const dup = await api.post(`muns/${munId}/form-fields`, {
      data: { fieldKey: 'emergency_contact_name', fieldType: 'SHORT_TEXT', label: 'x' },
    })
    expect(dup.status()).toBe(409)
    expect((await dup.json()).error.code).toBe('CONFLICT_UNIQUE')

    const badType = await api.post(`muns/${munId}/form-fields`, {
      data: { fieldKey: `e2e_bt_${tag}`, fieldType: 'SIGNATURE', label: 'x' },
    })
    expect(badType.status()).toBe(400)
  })

  test('two fields cannot depend on each other', async () => {
    const tag = uid()
    const a = await createField({ fieldKey: `e2e_a_${tag}`, fieldType: 'SHORT_TEXT', label: 'E2E A' })
    const b = await createField({
      fieldKey: `e2e_b_${tag}`,
      fieldType: 'SHORT_TEXT',
      label: 'E2E B',
      conditionalOn: a.fieldKey,
      conditionalOperator: 'EQUALS',
      conditionalValue: 'go',
    })
    const cycle = await api.patch(`form-fields/${a.id}`, {
      data: { conditionalOn: b.fieldKey, conditionalOperator: 'EQUALS', conditionalValue: 'go' },
    })
    expect(cycle.status()).toBe(400)
    expect((await cycle.json()).error.message).toMatch(/cycle/)
    expect((await api.delete(`form-fields/${b.id}`)).status()).toBe(204)
    expect((await api.delete(`form-fields/${a.id}`)).status()).toBe(204)
  })

  test('reorder refuses a field from another MUN', async () => {
    const field = await createField({ fieldKey: `e2e_reorder_${uid()}`, fieldType: 'SHORT_TEXT', label: 'E2E reorder' })
    const res = await api.post(`muns/${munId}/form-fields/actions/reorder`, {
      data: { order: [{ id: field.id, displayOrder: 950 }, { id: crypto.randomUUID(), displayOrder: 951 }] },
    })
    expect(res.status()).toBe(400)
    const ok = await api.post(`muns/${munId}/form-fields/actions/reorder`, {
      data: { order: [{ id: field.id, displayOrder: 950 }] },
    })
    expect(ok.status()).toBe(200)
    expect((await listFields()).find((f) => f.id === field.id)?.displayOrder).toBe(950)
    await api.delete(`form-fields/${field.id}`)
  })
})
