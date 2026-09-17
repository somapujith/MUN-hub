import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { SANDBOX } from '../../fixtures/fixture-muns'
import {
  main,
  openSection,
  organizerApi,
  sandboxId,
  toast,
  uid,
} from './_helpers'

/** MUN Setup — Basic Info + Dates & Venue (Onboarding PRD §9-10). Sandbox only; its name is never changed. */

interface MunDetails {
  id: string
  name: string
  edition: string | null
  theme: string | null
  description: string | null
  startDate: string | null
  endDate: string | null
  venue: string | null
  city: string | null
  country: string | null
  status: string
}

let api: APIRequestContext
let munId: string
let original: MunDetails

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
  original = await details()
})

test.afterAll(async () => {
  // Put the fixture's descriptive fields back so other specs see the baseline.
  const { edition, theme, description, venue, city, country } = original
  await api.patch(`muns/${munId}`, { data: { edition, theme, description, venue, city, country } })
  await api?.dispose()
})

async function details(): Promise<MunDetails> {
  const res = await api.get(`organizer/muns/${munId}/details`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function openSetup(page: Page) {
  await openSection(page, munId, 'setup', 'MUN Setup')
}

test.describe('MUN setup UI', () => {
  test('shows the conference record and its status', async ({ page }) => {
    await openSetup(page)
    const form = main(page).locator('form')
    await expect(form.getByLabel('Conference name')).toHaveValue(SANDBOX.name)
    await expect(form.getByLabel('Start date')).toHaveValue(original.startDate!.slice(0, 10))
    await expect(form.getByLabel('End date')).toHaveValue(original.endDate!.slice(0, 10))
    await expect(form.getByLabel('City')).toHaveValue(original.city ?? '')
    await expect(main(page).getByText(/Onboarding|Action required/).first()).toBeVisible()
  })

  test('edit the conference details and they persist', async ({ page }) => {
    const tag = uid()
    await openSetup(page)
    const form = main(page).locator('form')
    await expect(form.getByLabel('Conference name')).toHaveValue(SANDBOX.name)

    await form.getByLabel('Edition').fill(`E2E-${tag}`)
    await form.getByLabel('Theme').fill(`Diplomacy after the algorithm ${tag}`)
    await form.getByLabel('Description').fill(`Updated by the organizer E2E suite (${tag}).`)
    await form.getByLabel('Venue').fill(`E2E Hall ${tag}`)
    await form.getByLabel('Country').fill('India')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Conference details saved')).toBeVisible()

    const saved = await details()
    expect(saved).toMatchObject({
      name: SANDBOX.name,
      edition: `E2E-${tag}`,
      theme: `Diplomacy after the algorithm ${tag}`,
      venue: `E2E Hall ${tag}`,
    })

    await page.reload()
    await expect(form.getByLabel('Theme')).toHaveValue(`Diplomacy after the algorithm ${tag}`)
    await expect(form.getByLabel('Venue')).toHaveValue(`E2E Hall ${tag}`)
  })

  test('clearing an optional field saves it as empty', async ({ page }) => {
    await openSetup(page)
    const form = main(page).locator('form')
    await expect(form.getByLabel('Conference name')).toHaveValue(SANDBOX.name)
    await form.getByLabel('Edition').fill('')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Conference details saved')).toBeVisible()
    expect((await details()).edition).toBeNull()
  })

  test('the conference name is required', async ({ page }) => {
    await openSetup(page)
    const form = main(page).locator('form')
    await expect(form.getByLabel('Conference name')).toHaveValue(SANDBOX.name)
    await form.evaluate((el) => el.setAttribute('novalidate', ''))
    await form.getByLabel('Conference name').fill('  ')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Conference name is required')).toBeVisible()
    expect((await details()).name).toBe(SANDBOX.name)
  })

  test('the go-live progress panel lists every module', async ({ page }) => {
    await openSetup(page)
    const progress = await (await api.get(`muns/${munId}/progress`)).json()
    await expect(main(page).getByText(`${progress.requiredComplete}/${progress.requiredTotal} required modules complete`)).toBeVisible()
    const panel = main(page).getByRole('complementary')
    for (const module of progress.modules as Array<{ label: string }>) {
      await expect(panel.getByRole('listitem').filter({ hasText: module.label }).first()).toBeVisible()
    }
  })
})

test.describe('MUN setup API', () => {
  test('invalid details are refused', async () => {
    for (const data of [
      { name: '' },
      { startDate: 'not-a-date' },
      { slug: 'hijack' },
      { status: 'PUBLISHED' },
      { organizerId: crypto.randomUUID() },
    ]) {
      const res = await api.patch(`muns/${munId}`, { data })
      expect(res.status(), JSON.stringify(data)).toBe(400)
    }
    const after = await details()
    expect(after.name).toBe(SANDBOX.name)
    expect(after.status).toMatch(/ONBOARDING|ACTION_REQUIRED/)
  })

  test('address, map link and registration window are saved and can be cleared (73bcdf4)', async () => {
    const opens = new Date(Date.now() + 7 * 86_400_000)
    const deadline = new Date(Date.now() + 30 * 86_400_000)
    const data = {
      addressLine1: `E2E Hall ${uid()}, Jubilee Hills`,
      addressState: 'Telangana',
      postalCode: '500033',
      mapUrl: 'https://maps.example.com/e2e-venue',
      registrationOpensAt: opens.toISOString(),
      registrationDeadline: deadline.toISOString(),
    }
    try {
      const res = await api.patch(`muns/${munId}`, { data })
      expect(res.status(), await res.text()).toBe(200)
      const saved = await res.json()
      expect(saved).toMatchObject({
        addressLine1: data.addressLine1,
        addressState: 'Telangana',
        postalCode: '500033',
        mapUrl: data.mapUrl,
      })
      expect(new Date(saved.registrationOpensAt).getTime()).toBe(opens.getTime())
      expect(new Date(saved.registrationDeadline).getTime()).toBe(deadline.getTime())
    } finally {
      const cleared = await api.patch(`muns/${munId}`, {
        data: {
          addressLine1: null,
          addressState: null,
          postalCode: null,
          mapUrl: null,
          registrationOpensAt: null,
          registrationDeadline: null,
        },
      })
      expect(cleared.status()).toBe(200)
      expect(await cleared.json()).toMatchObject({ addressLine1: null, mapUrl: null, registrationDeadline: null })
    }
  })

  test('a map link must be a URL and dates must be dates', async () => {
    for (const data of [{ mapUrl: 'not a url' }, { registrationOpensAt: 'soon' }, { registrationDeadline: 'later' }]) {
      const res = await api.patch(`muns/${munId}`, { data })
      expect(res.status(), JSON.stringify(data)).toBe(400)
    }
  })

  test('a registration deadline before registration opens is refused', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: updateMunDetails (lib/actions/mun-config.ts) accepts registrationDeadline earlier than registrationOpensAt',
    )
    const res = await api.patch(`muns/${munId}`, {
      data: {
        registrationOpensAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        registrationDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    })
    try {
      expect(res.status()).toBe(400)
    } finally {
      await api.patch(`muns/${munId}`, { data: { registrationOpensAt: null, registrationDeadline: null } })
    }
  })

  test('an optional detail can be cleared and restored', async () => {
    const res = await api.patch(`muns/${munId}`, { data: { venue: null } })
    expect(res.status()).toBe(200)
    expect((await res.json()).venue).toBeNull()
    const restore = await api.patch(`muns/${munId}`, { data: { venue: original.venue } })
    expect((await restore.json()).venue).toBe(original.venue)
  })
})
