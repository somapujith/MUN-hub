import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { SANDBOX } from '../../fixtures/fixture-muns'
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

/** Conference Day — the SCHEDULE module (Onboarding PRD §21). Sandbox only; items created here are removed again. */

const REGION = 'Schedule items'
const COMMITTEE = SANDBOX.committees[0].name

interface ScheduleItem {
  id: string
  title: string
  kind: string
  committeeId: string | null
  startsAt: string
  endsAt: string
  location: string | null
}

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  for (const item of await listItems()) {
    if (item.title.startsWith('E2E ')) await api.delete(`schedule/${item.id}`)
  }
  await api?.dispose()
})

async function listItems(): Promise<ScheduleItem[]> {
  const res = await api.get(`muns/${munId}/schedule`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function openSchedule(page: Page) {
  await openSection(page, munId, 'conference-day', /^Conference day$/i)
}

test.describe('conference day UI', () => {
  test('add, edit and delete a schedule item', async ({ page }) => {
    const title = `E2E Opening ${uid()}`
    await openSchedule(page)

    await main(page).getByRole('button', { name: 'Add schedule item' }).click()
    const form = main(page).locator('form')
    await form.getByLabel('Title').fill(title)
    await form.getByLabel('Kind').selectOption({ label: 'Opening ceremony' })
    await form.getByLabel('Committee').selectOption({ label: COMMITTEE })
    await form.getByLabel('Starts').fill('2026-12-16T09:00')
    await form.getByLabel('Ends').fill('2026-12-16T10:30')
    await form.getByLabel('Location').fill('E2E Main Auditorium')
    await form.getByRole('button', { name: 'Add item' }).click()

    await expect(toast(page, 'Schedule item added')).toBeVisible()
    const card = cardFor(page, REGION, title)
    await expect(card).toContainText('Opening ceremony')
    await expect(card).toContainText('E2E Main Auditorium')
    await expect(card).toContainText(COMMITTEE)
    await expect(card).toContainText(/Wed, Dec 16/)

    const saved = (await listItems()).find((i) => i.title === title)!
    expect(saved.kind).toBe('OPENING_CEREMONY')
    expect(new Date(saved.endsAt).getTime() - new Date(saved.startsAt).getTime()).toBe(90 * 60 * 1000)

    await main(page).getByRole('button', { name: `Edit ${title}` }).click()
    await expect(form.getByLabel('Starts')).toHaveValue('2026-12-16T09:00')
    await form.getByLabel('Kind').selectOption({ label: 'Committee session' })
    await form.getByLabel('Committee').selectOption({ label: 'Conference-wide' })
    await form.getByLabel('Location').fill('E2E Room 101')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Schedule item updated')).toBeVisible()
    await expect(card).toContainText('Committee session')
    await expect(card).toContainText('E2E Room 101')
    await expect(card).toContainText('Conference-wide')

    // The published schedule is public.
    const anon = await anonApi()
    const publicItems: ScheduleItem[] = await (await anon.get(`muns/${munId}/schedule`)).json()
    expect(publicItems.find((i) => i.id === saved.id)?.location).toBe('E2E Room 101')
    await anon.dispose()

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${title}` }).click()
    await expect(main(page).getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    expect((await listItems()).map((i) => i.id)).not.toContain(saved.id)
  })

  test('items are listed in chronological order', async ({ page }) => {
    const tag = uid()
    for (const [title, start] of [
      [`E2E Late ${tag}`, '2026-12-17T15:00:00Z'],
      [`E2E Early ${tag}`, '2026-12-17T08:00:00Z'],
    ]) {
      const res = await api.post(`muns/${munId}/schedule`, {
        data: { title, kind: 'BREAK', startsAt: start, endsAt: new Date(new Date(start).getTime() + 1800_000).toISOString() },
      })
      expect(res.status()).toBe(201)
    }
    await openSchedule(page)
    const titles = main(page).getByRole('region', { name: REGION }).getByRole('heading', { level: 2 })
    await expect(titles.filter({ hasText: tag })).toHaveText([`E2E Early ${tag}`, `E2E Late ${tag}`])
  })

  test('an item must end after it starts', async ({ page }) => {
    const title = `E2E Backwards ${uid()}`
    await openSchedule(page)
    await main(page).getByRole('button', { name: 'Add schedule item' }).click()
    const form = main(page).locator('form')
    await form.getByLabel('Title').fill(title)
    await form.getByLabel('Starts').fill('2026-12-16T12:00')
    await form.getByLabel('Ends').fill('2026-12-16T11:00')
    await form.getByRole('button', { name: 'Add item' }).click()
    await expect(toast(page, 'End time must be after start time')).toBeVisible()
    expect((await listItems()).map((i) => i.title)).not.toContain(title)
  })
})

test.describe('conference day API', () => {
  test('create and update a schedule item', async () => {
    const res = await api.post(`muns/${munId}/schedule`, {
      data: { title: `E2E Lunch ${uid()}`, kind: 'LUNCH', startsAt: '2026-12-16T12:00:00Z', endsAt: '2026-12-16T13:00:00Z', location: 'Cafeteria' },
    })
    expect(res.status()).toBe(201)
    const item: ScheduleItem = await res.json()
    const patched = await api.patch(`schedule/${item.id}`, { data: { kind: 'AWARDS', location: null } })
    expect(patched.status()).toBe(200)
    expect(await patched.json()).toMatchObject({ kind: 'AWARDS', location: null })
    expect((await api.delete(`schedule/${item.id}`)).status()).toBe(204)
  })

  test('schema violations are refused', async () => {
    for (const data of [
      { title: '', kind: 'LUNCH', startsAt: '2026-12-16T12:00:00Z', endsAt: '2026-12-16T13:00:00Z' },
      { title: 'E2E x', kind: 'PARTY', startsAt: '2026-12-16T12:00:00Z', endsAt: '2026-12-16T13:00:00Z' },
      { title: 'E2E x', kind: 'LUNCH', startsAt: 'soon', endsAt: '2026-12-16T13:00:00Z' },
      { title: 'E2E x', kind: 'LUNCH' },
    ]) {
      expect((await api.post(`muns/${munId}/schedule`, { data })).status(), JSON.stringify(data)).toBe(400)
    }
  })

  test('an item that ends before it starts is a validation error, not a server error', async () => {
    const res = await api.post(`muns/${munId}/schedule`, {
      data: { title: `E2E Backwards API ${uid()}`, kind: 'OTHER', startsAt: '2026-12-16T12:00:00Z', endsAt: '2026-12-16T11:00:00Z' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
  })
})
