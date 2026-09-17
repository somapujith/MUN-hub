import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { SANDBOX } from '../../fixtures/fixture-muns'
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
  await prepareWorkspace(page, api)
  await openSection(page, munId, 'committees', 'Committees')
}

test.describe('committees UI', () => {
  test('lists the sandbox\'s existing committee', async ({ page }) => {
    expectWorkspaceBug()
    await openCommittees(page)
    const existing = SANDBOX.committees[0]
    await expect(main(page).getByRole('heading', { name: existing.name })).toBeVisible()
    await expect(committeeCard(page, existing.name)).toContainText(`Capacity ${existing.capacity}`)
  })

  test('create, edit, and delete a committee', async ({ page }) => {
    expectWorkspaceBug()
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
    expectWorkspaceBug()
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
    expectWorkspaceBug()
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

  test.fixme('portfolios can be managed from the Committees & Portfolios section', async () => {
    // PRD §13: portfolio/country/role, availability, restrictions. The
    // section (web/src/pages/organizer/dashboard/sections/committees-page.tsx)
    // has no portfolio UI at all, although the API supports it (covered below).
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
