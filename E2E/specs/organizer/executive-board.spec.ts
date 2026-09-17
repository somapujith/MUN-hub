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

/** Executive Board module (Onboarding PRD §14). Sandbox only; members created here are removed again. */

const REGION = 'Executive board members'
const COMMITTEE = SANDBOX.committees[0].name
// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

interface Member {
  id: string
  name: string
  role: string
  customRole: string | null
  committeeId: string | null
  isPublic: boolean
  displayOrder: number
  photoUrl: string | null
}

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  for (const m of await listMembers()) {
    if (m.name.startsWith('E2E ')) await api.delete(`executive-board/${m.id}`)
  }
  await api?.dispose()
})

async function listMembers(): Promise<Member[]> {
  const res = await api.get(`muns/${munId}/executive-board/manage`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function createMember(data: Record<string, unknown>): Promise<Member> {
  const res = await api.post(`muns/${munId}/executive-board`, { data })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

async function openBoard(page: Page) {
  await openSection(page, munId, 'executive-board', 'Executive Board')
}

test.describe('executive board UI', () => {
  test('add a committee chair, edit them, hide them, then delete them', async ({ page }) => {
    const name = `E2E Chair ${uid()}`
    await openBoard(page)

    await main(page).getByRole('button', { name: 'Add member' }).first().click()
    const form = main(page).locator('form')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Role', { exact: true }).selectOption({ label: 'Director' })
    await form.getByLabel('Committee assignment').selectOption({ label: COMMITTEE })
    await form.getByLabel('Institution').fill('E2E Law School')
    await form.getByLabel('Organization').fill('E2E Debating Society')
    await form.getByLabel('Website or social link').fill('https://example.com/e2e-chair')
    await form.getByLabel('Bio').fill('Chaired twelve conferences.')
    await form.getByRole('button', { name: 'Add member' }).click()

    await expect(toast(page, 'Board member added')).toBeVisible()
    const card = cardFor(page, REGION, name)
    await expect(card).toContainText(`Director · ${COMMITTEE}`)
    await expect(card).toContainText('E2E Law School')
    await expect(card).toContainText('Chaired twelve conferences.')
    await expect(card).toContainText('website: https://example.com/e2e-chair')
    await expect(card).not.toContainText('Hidden')

    const saved = (await listMembers()).find((m) => m.name === name)!
    expect(saved).toMatchObject({ role: 'DIRECTOR', isPublic: true })
    // The sandbox isn't published, so its board stays private (b411b4b).
    const publicBoard = await anonApi()
    expect((await publicBoard.get(`muns/${munId}/executive-board`)).status()).toBe(404)

    await main(page).getByRole('button', { name: `Edit ${name}` }).click()
    await expect(form.getByLabel('Name')).toHaveValue(name)
    await form.getByLabel('Role', { exact: true }).selectOption({ label: 'Chair' })
    await form.getByLabel('Committee assignment').selectOption({ label: 'Conference-wide' })
    await form.getByLabel('Show this member on the public conference page').uncheck()
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Board member updated')).toBeVisible()
    await expect(card).toContainText('Chair · Conference-wide')
    await expect(card).toContainText('Hidden')

    // Hidden from the public roster once the MUN is live.
    expect((await listMembers()).find((m) => m.id === saved.id)?.isPublic).toBe(false)
    await publicBoard.dispose()

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${name}` }).click()
    await expect(main(page).getByRole('heading', { name, exact: true })).toHaveCount(0)
    expect((await listMembers()).map((m) => m.id)).not.toContain(saved.id)
  })

  test('a photo can be uploaded with a new member, then changed and removed (cb5abc7)', async ({ page }) => {
    const name = `E2E Photo Chair ${uid()}`
    await openBoard(page)
    await main(page).getByRole('button', { name: 'Add member' }).first().click()
    const form = main(page).locator('form')
    await expect(form.getByLabel('Photo URL')).toHaveCount(0)
    await expect(form.getByLabel('Display order')).toHaveCount(0)
    await expect(form).toContainText('A square headshot works best. PNG, JPEG or WebP, max 5MB.')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Role', { exact: true }).selectOption({ label: 'Director' })

    // A non-image is refused before upload.
    await form.getByLabel('Photo (optional)').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
    await expect(toast(page, 'Use a PNG, JPEG or WebP image')).toBeVisible()

    await form.getByLabel('Photo (optional)').setInputFiles({ name: 'chair.png', mimeType: 'image/png', buffer: PNG })
    await expect(form.getByRole('button', { name: 'Change photo' })).toBeVisible()
    await form.getByRole('button', { name: 'Add member' }).click()
    await expect(toast(page, 'Board member added')).toBeVisible()
    await expect.poll(async () => (await listMembers()).find((m) => m.name === name)?.photoUrl ?? null).toBeTruthy()
    const saved = (await listMembers()).find((m) => m.name === name)!

    // While editing, photo changes apply immediately.
    await main(page).getByRole('button', { name: `Edit ${name}` }).click()
    await form.getByLabel('Photo (optional)').setInputFiles({ name: 'chair-2.png', mimeType: 'image/png', buffer: PNG })
    await expect(toast(page, 'Photo updated')).toBeVisible()
    await form.getByRole('button', { name: 'Remove' }).click()
    await expect(toast(page, 'Photo removed')).toBeVisible()
    await expect.poll(async () => (await listMembers()).find((m) => m.id === saved.id)?.photoUrl ?? null).toBeNull()
    await api.delete(`executive-board/${saved.id}`)
  })

  test('the photo API accepts only real images, from the owner', async () => {
    const created = await api.post(`muns/${munId}/executive-board`, { data: { name: `E2E Photo API ${uid()}`, role: 'DIRECTOR' } })
    expect(created.status(), await created.text()).toBe(201)
    const member = (await created.json()) as Member
    try {
      const up = await api.post(`executive-board/${member.id}/photo`, {
        data: { contentType: 'image/png', fileBase64: PNG.toString('base64') },
      })
      expect(up.status(), await up.text()).toBe(200)
      expect(((await up.json()) as Member).photoUrl).toBeTruthy()

      const fake = await api.post(`executive-board/${member.id}/photo`, {
        data: { contentType: 'image/png', fileBase64: Buffer.from('not an image').toString('base64') },
      })
      expect(fake.status()).toBe(400)
      expect((await api.post(`executive-board/${member.id}/photo`, { data: { contentType: 'image/gif', fileBase64: PNG.toString('base64') } })).status()).toBe(400)

      const anon = await anonApi()
      expect((await anon.post(`executive-board/${member.id}/photo`, { data: { contentType: 'image/png', fileBase64: PNG.toString('base64') } })).status()).toBe(401)
      expect((await anon.delete(`executive-board/${member.id}/photo`)).status()).toBe(401)
      await anon.dispose()

      const removed = await api.delete(`executive-board/${member.id}/photo`)
      expect(removed.status()).toBe(200)
      expect(((await removed.json()) as Member).photoUrl).toBeNull()
    } finally {
      await api.delete(`executive-board/${member.id}`)
    }
  })

  test('a custom role needs its title', async ({ page }) => {
    const name = `E2E Custom ${uid()}`
    await openBoard(page)
    await main(page).getByRole('button', { name: 'Add member' }).first().click()
    const form = main(page).locator('form')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Role', { exact: true }).selectOption({ label: 'Custom role' })
    await form.getByRole('button', { name: 'Add member' }).click()
    await expect(toast(page, 'Name and custom role are required')).toBeVisible()

    await form.getByLabel('Custom role').fill('Crisis Director')
    await form.getByRole('button', { name: 'Add member' }).click()
    await expect(toast(page, 'Board member added')).toBeVisible()
    await expect(cardFor(page, REGION, name)).toContainText('Crisis Director · Conference-wide')
  })

  test('reorder members with the move buttons', async ({ page }) => {
    const tag = uid()
    const a = await createMember({ name: `E2E Order A ${tag}`, role: 'CHAIR', displayOrder: 800 })
    const b = await createMember({ name: `E2E Order B ${tag}`, role: 'RAPPORTEUR', displayOrder: 801 })
    await openBoard(page)
    const names = main(page).getByRole('region', { name: REGION }).getByRole('heading', { level: 2 })
    await expect(names.filter({ hasText: tag })).toHaveText([a.name, b.name])
    await cardFor(page, REGION, b.name).getByRole('button', { name: 'Move member up' }).click()
    await expect(names.filter({ hasText: tag })).toHaveText([b.name, a.name])
    const saved = await listMembers()
    expect(saved.find((m) => m.id === b.id)?.displayOrder).toBe(800)
    expect(saved.find((m) => m.id === a.id)?.displayOrder).toBe(801)
  })
})

test.describe('executive board API', () => {
  test('create, update and delete a member; bad input is refused', async () => {
    const member = await createMember({ name: `E2E API Member ${uid()}`, role: 'VICE_CHAIR', isPublic: false })
    expect(member).toMatchObject({ role: 'VICE_CHAIR', isPublic: false })

    const updated = await api.patch(`executive-board/${member.id}`, { data: { role: 'CUSTOM', customRole: 'Press Head' } })
    expect(updated.status()).toBe(200)
    expect(await updated.json()).toMatchObject({ role: 'CUSTOM', customRole: 'Press Head' })

    for (const data of [
      { name: 'E2E x', role: 'CUSTOM' },
      { name: 'E2E x', role: 'EMPEROR' },
      { name: '', role: 'CHAIR' },
      { name: 'E2E x', role: 'CHAIR', committeeId: 'not-a-uuid' },
    ]) {
      expect((await api.post(`muns/${munId}/executive-board`, { data })).status(), JSON.stringify(data)).toBe(400)
    }

    expect((await api.delete(`executive-board/${member.id}`)).status()).toBe(204)
    expect((await listMembers()).map((m) => m.id)).not.toContain(member.id)
  })

  test('a member cannot be assigned to another MUN\'s committee', async () => {
    const anon = await anonApi()
    const oxford = await (await anon.get('muns/oxford-mun-2027')).json()
    await anon.dispose()
    const res = await api.post(`muns/${munId}/executive-board`, {
      data: { name: `E2E Foreign ${uid()}`, role: 'CHAIR', committeeId: oxford.committees[0].id },
    })
    expect(res.status()).toBe(403)
  })
})
