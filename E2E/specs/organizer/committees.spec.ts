import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { SANDBOX } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import {
  acceptNextConfirm,
  anonApi,
  cardFor,
  main,
  openSection,
  organizerApi,
  sandboxId,
  toast,
  uid,
} from './_helpers'

/** Committees & Portfolios module (Onboarding PRD §12-13), on the sandbox MUN only. */

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  // Sweep committees this spec created, including ones left by a failed run.
  const committees: Array<{ id: string; name: string }> = await (await api.get(`muns/${munId}/committees`)).json()
  for (const c of committees) {
    if (c.name.startsWith('E2E ') && c.name !== SANDBOX.committees[0].name) await api.delete(`committees/${c.id}`)
  }
  await api?.dispose()
})

function committeeCard(page: Page, name: string) {
  return cardFor(page, 'Committees', name)
}

async function openCommittees(page: Page) {
  await openSection(page, munId, 'committees', 'Committees')
}

test.describe('committees UI', () => {
  test('lists the sandbox\'s existing committee', async ({ page }) => {
    await openCommittees(page)
    const existing = SANDBOX.committees[0]
    await expect(main(page).getByRole('heading', { name: existing.name })).toBeVisible()
    await expect(committeeCard(page, existing.name)).toContainText(`Capacity ${existing.capacity}`)
  })

  test('create, edit, and delete a committee', async ({ page }) => {
    const name = `E2E Committee ${uid()}`
    await openCommittees(page)

    await main(page).getByRole('button', { name: 'Add committee' }).first().click()
    const form = main(page).locator('form')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Agenda').fill('Cyber norms in armed conflict')
    await form.getByLabel('Capacity').fill('60')
    await form.getByLabel('Description').fill('A double-delegation general assembly committee.')
    await form.getByRole('button', { name: 'Add committee' }).click()

    await expect(toast(page, 'Committee added')).toBeVisible()
    await expect(form).toHaveCount(0)
    const card = committeeCard(page, name)
    await expect(card).toContainText('Capacity 60')
    await expect(card).toContainText('Cyber norms in armed conflict')
    await expect(card).toContainText('A double-delegation general assembly committee.')

    await main(page).getByRole('button', { name: `Edit ${name}` }).click()
    await expect(form.getByLabel('Name')).toHaveValue(name)
    await expect(form.getByLabel('Capacity')).toHaveValue('60')
    await form.getByLabel('Agenda').fill('Autonomous weapons and accountability')
    await form.getByLabel('Capacity').fill('75')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Committee updated')).toBeVisible()
    await expect(card).toContainText('Capacity 75')
    await expect(card).toContainText('Autonomous weapons and accountability')

    // Survives a reload (it was saved, not just held in page state).
    await page.reload()
    await expect(committeeCard(page, name)).toContainText('Capacity 75')

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${name}` }).click()
    await expect(main(page).getByRole('heading', { name, exact: true })).toHaveCount(0)
    const list = await (await api.get(`muns/${munId}/committees`)).json()
    expect(list.map((c: { name: string }) => c.name)).not.toContain(name)
  })

  test('cancelling a delete keeps the committee', async ({ page }) => {
    const name = `E2E Keep Committee ${uid()}`
    const created = await api.post(`muns/${munId}/committees`, { data: { name, capacity: 5 } })
    expect(created.status()).toBe(201)
    await openCommittees(page)
    page.once('dialog', (dialog) => void dialog.dismiss())
    await main(page).getByRole('button', { name: `Delete ${name}` }).click()
    await expect(main(page).getByRole('heading', { name, exact: true })).toBeVisible()
    await api.delete(`committees/${(await created.json()).id}`)
  })

  test('capacity and name are validated before saving', async ({ page }) => {
    await openCommittees(page)
    await main(page).getByRole('button', { name: 'Add committee' }).first().click()
    const form = main(page).locator('form')
    // Bypass the native constraints so the page's own validation runs.
    await form.evaluate((el) => el.setAttribute('novalidate', ''))

    await form.getByLabel('Name').fill('   ')
    await form.getByRole('button', { name: 'Add committee' }).click()
    await expect(toast(page, 'Committee name is required')).toBeVisible()

    await form.getByLabel('Name').fill(`E2E Zero Capacity ${uid()}`)
    await form.getByLabel('Capacity').fill('0')
    await form.getByRole('button', { name: 'Add committee' }).click()
    await expect(toast(page, 'Capacity must be a whole number of at least 1')).toBeVisible()
    // Still open, nothing created.
    await expect(form).toBeVisible()

    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toHaveCount(0)
  })

})

test.describe('portfolios UI (6f3d74f)', () => {
  async function freshCommittee(): Promise<{ id: string; name: string }> {
    const name = `E2E Portfolio Committee ${uid()}`
    const res = await api.post(`muns/${munId}/committees`, { data: { name, capacity: 40 } })
    expect(res.status(), await res.text()).toBe(201)
    return res.json()
  }

  async function portfoliosOf(committeeId: string): Promise<Array<{ name: string; type: string | null; availability: number }>> {
    const res = await api.get(`committees/${committeeId}/portfolios`)
    expect(res.status()).toBe(200)
    return res.json()
  }

  test('add one at a time, add a list, edit and remove', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const committee = await freshCommittee()
    await openSection(page, munId, 'committees', 'Committees & Portfolios')
    const block = page.getByTestId(`portfolios-${committee.id}`)
    await expect(block).toContainText('0 portfolios · 0 seats')
    await expect(block).toContainText('Add at least one portfolio with a seat so delegates can pick this committee.')

    // One at a time; the form stays open for the next one.
    await block.getByRole('button', { name: 'Add portfolio' }).click()
    await block.getByLabel('Portfolio name').fill('India')
    await block.getByLabel('Type').selectOption({ label: 'Country' })
    await block.getByLabel('Seats').fill('2')
    await block.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(toast(page, 'India added')).toBeVisible()
    await expect(block.getByLabel('Portfolio name')).toBeVisible()
    // A duplicate (case and spaces ignored) is caught before sending.
    await block.getByLabel('Portfolio name').fill('  india ')
    await block.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(toast(page, 'A portfolio named "india" already exists in this committee')).toBeVisible()
    await block.getByRole('button', { name: 'Done' }).click()
    await expect(block).toContainText('1 portfolio · 2 seats')
    await expect(block).not.toContainText('Add at least one portfolio with a seat')

    // A list, with duplicates flagged until they're removed.
    await block.getByRole('button', { name: 'Add a list' }).click()
    const names = block.getByLabel('Portfolio names, one per line')
    await names.fill('Brazil\nJapan, india\nBrazil')
    await expect(block).toContainText('Already in this committee or listed twice:')
    await expect(block.getByRole('button', { name: /^Add \d+ portfolios?$/ })).toBeDisabled()
    await names.fill('Brazil\nJapan, Kenya')
    await block.getByLabel('Type for all').selectOption({ label: 'Country' })
    await block.getByLabel('Seats each').fill('1')
    await block.getByRole('button', { name: 'Add 3 portfolios' }).click()
    await expect(toast(page, '3 portfolios added')).toBeVisible()
    await expect(block).toContainText('4 portfolios · 5 seats')

    // Edit inline.
    await block.getByRole('button', { name: 'Edit Kenya' }).click()
    await block.getByLabel('Seats').fill('0')
    await block.getByRole('button', { name: 'Save portfolio' }).click()
    await expect(toast(page, 'Portfolio updated')).toBeVisible()
    await expect(block.getByRole('listitem').filter({ hasText: 'Kenya' })).toContainText('No seats')

    // Remove, with a confirmation.
    acceptNextConfirm(page)
    await block.getByRole('button', { name: 'Remove Japan' }).click()
    await expect(toast(page, 'Portfolio removed')).toBeVisible()
    await expect(block).toContainText('3 portfolios · 3 seats')

    const saved = await portfoliosOf(committee.id)
    expect(saved.map((p) => p.name).sort()).toEqual(['Brazil', 'India', 'Kenya'])
    expect(saved.find((p) => p.name === 'Kenya')?.availability).toBe(0)
    expect(saved.find((p) => p.name === 'India')).toMatchObject({ type: 'country', availability: 2 })
    crashes.assertNone()
  })

  test('the bulk API adds many at once and refuses duplicates', async () => {
    const committee = await freshCommittee()
    const bulk = await api.post(`committees/${committee.id}/portfolios/bulk`, {
      data: { portfolios: [{ name: 'Chile' }, { name: 'Peru', type: 'country', availability: 2 }] },
    })
    expect(bulk.status(), await bulk.text()).toBe(201)
    expect((await portfoliosOf(committee.id)).map((p) => p.name).sort()).toEqual(['Chile', 'Peru'])

    for (const [path, data] of [
      [`committees/${committee.id}/portfolios`, { name: ' chile ' }],
      [`committees/${committee.id}/portfolios/bulk`, { portfolios: [{ name: 'PERU' }] }],
    ] as const) {
      const res = await api.post(path, { data })
      expect(res.status(), path).toBe(409)
      expect((await res.json()).error.code).toBe('CONFLICT_UNIQUE')
    }
    expect((await api.post(`committees/${committee.id}/portfolios/bulk`, { data: { portfolios: [] } })).status()).toBe(400)
    const tooMany = Array.from({ length: 301 }, (_, i) => ({ name: `E2E P${i}` }))
    expect((await api.post(`committees/${committee.id}/portfolios/bulk`, { data: { portfolios: tooMany } })).status()).toBe(400)

    const anon = await anonApi()
    expect((await anon.post(`committees/${committee.id}/portfolios/bulk`, { data: { portfolios: [{ name: 'X' }] } })).status()).toBe(401)
    await anon.dispose()
  })
})

test.describe('committees & portfolios API', () => {
  test('create, update, and delete a committee and its portfolios', async () => {
    const name = `E2E API Committee ${uid()}`
    const created = await api.post(`muns/${munId}/committees`, {
      data: { name, capacity: 30, agenda: 'Maritime security', description: 'Crisis-flavoured GA' },
    })
    expect(created.status()).toBe(201)
    const committee = await created.json()
    expect(committee).toMatchObject({ name, capacity: 30, agenda: 'Maritime security', munId })

    const portfolioRes = await api.post(`committees/${committee.id}/portfolios`, {
      data: { name: 'Norway', type: 'country', availability: 1 },
    })
    expect(portfolioRes.status()).toBe(201)
    const portfolio = await portfolioRes.json()
    const second = await api.post(`committees/${committee.id}/portfolios`, { data: { name: 'Chile' } })
    expect(second.status()).toBe(201)

    const listed = await (await api.get(`committees/${committee.id}/portfolios`)).json()
    expect(listed.map((p: { name: string }) => p.name).sort()).toEqual(['Chile', 'Norway'])

    const renamed = await api.patch(`portfolios/${portfolio.id}`, { data: { name: 'Kingdom of Norway', availability: 2 } })
    expect(renamed.status()).toBe(200)
    expect(await renamed.json()).toMatchObject({ name: 'Kingdom of Norway', availability: 2 })

    const updated = await api.patch(`committees/${committee.id}`, { data: { capacity: 45 } })
    expect(updated.status()).toBe(200)
    expect((await updated.json()).capacity).toBe(45)

    expect((await api.delete(`portfolios/${portfolio.id}`)).status()).toBe(204)
    const afterDelete = await (await api.get(`committees/${committee.id}/portfolios`)).json()
    expect(afterDelete.map((p: { name: string }) => p.name)).toEqual(['Chile'])

    expect((await api.delete(`portfolios/${(await second.json()).id}`)).status()).toBe(204)
    expect((await api.delete(`committees/${committee.id}`)).status()).toBe(204)
    const committees = await (await api.get(`muns/${munId}/committees`)).json()
    expect(committees.map((c: { id: string }) => c.id)).not.toContain(committee.id)
  })

  test('invalid committee and portfolio input is refused', async () => {
    for (const data of [
      { name: 'E2E bad capacity', capacity: 0 },
      { name: 'E2E bad capacity', capacity: -5 },
      { name: 'E2E bad capacity', capacity: 2.5 },
      { name: '', capacity: 10 },
      { capacity: 10 },
      { name: 'E2E missing capacity' },
      { name: 'E2E extra field', capacity: 10, munId: crypto.randomUUID() },
    ]) {
      const res = await api.post(`muns/${munId}/committees`, { data })
      expect(res.status(), JSON.stringify(data)).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    }

    const sandboxCommittee = (await (await api.get(`muns/${munId}/committees`)).json()).find(
      (c: { name: string }) => c.name === SANDBOX.committees[0].name,
    )
    expect((await api.patch(`committees/${sandboxCommittee.id}`, { data: { capacity: 0 } })).status()).toBe(400)
    expect(
      (await api.post(`committees/${sandboxCommittee.id}/portfolios`, { data: { name: 'x', availability: -1 } })).status(),
    ).toBe(400)
    expect((await api.post(`committees/${sandboxCommittee.id}/portfolios`, { data: { name: '' } })).status()).toBe(400)
  })

  test('committee writes need a signed-in organizer', async () => {
    const anon = await anonApi()
    const res = await anon.post(`muns/${munId}/committees`, { data: { name: `E2E anon ${uid()}`, capacity: 1 } })
    expect(res.status()).toBe(401)
    await anon.dispose()
  })
})
