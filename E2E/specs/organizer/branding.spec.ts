import { expect, test, type APIRequestContext } from '@playwright/test'
import { watchForCrashes } from '../../fixtures/ui'
import { acceptNextConfirm, anonApi, main, openSection, organizerApi, sandboxId, toast } from './_helpers'

/**
 * Branding & Media module (Onboarding PRD §11: logo + cover required).
 * The upload UI lives on the Documents & Media page (87d7102).
 * Every upload is deleted again — go-live.spec relies on the sandbox
 * staying incomplete (no logo/cover).
 */

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

interface Media {
  id: string
  kind: string
  url: string
  displayOrder: number
}

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  for (const m of await listMedia()) await api.delete(`media/${m.id}`)
  await api?.dispose()
})

async function listMedia(): Promise<Media[]> {
  const res = await api.get(`muns/${munId}/media`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function upload(kind: string, displayOrder?: number): Promise<Media> {
  const res = await api.post(`muns/${munId}/media`, {
    data: { kind, contentType: 'image/png', fileBase64: PNG.toString('base64'), displayOrder },
  })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

test.describe('branding UI (Documents & Media page)', () => {
  test('upload, replace and remove the logo and cover image', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openSection(page, munId, 'documents', 'Documents & Media')
    await expect(main(page).getByRole('heading', { level: 2, name: 'Branding' })).toBeVisible()

    for (const { kind, input, uploadBtn, replaceBtn, alt, uploaded, removed } of [
      {
        kind: 'LOGO',
        input: 'Logo image (max 2MB)',
        uploadBtn: 'Upload logo',
        replaceBtn: 'Replace logo',
        alt: 'Current logo',
        uploaded: 'Logo uploaded',
        removed: 'Logo removed',
      },
      {
        kind: 'COVER',
        input: 'Cover image (max 5MB)',
        uploadBtn: 'Upload cover image',
        replaceBtn: 'Replace cover image',
        alt: 'Current cover image',
        uploaded: 'Cover image uploaded',
        removed: 'Cover image removed',
      },
    ]) {
      const section = page.getByTestId(`branding-${kind}`)
      await expect(section.getByRole('button', { name: uploadBtn })).toBeVisible()
      await expect(section.getByRole('img', { name: alt })).toHaveCount(0)

      await section.getByLabel(input).setInputFiles({ name: `${kind.toLowerCase()}.png`, mimeType: 'image/png', buffer: PNG })
      await expect(toast(page, uploaded)).toBeVisible()
      const preview = section.getByRole('img', { name: alt })
      await expect(preview).toBeVisible()
      // The stored file is really served (STORAGE_ADAPTER=local in the E2E API).
      await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
      await expect(section.getByRole('button', { name: replaceBtn })).toBeVisible()
      expect((await listMedia()).filter((m) => m.kind === kind)).toHaveLength(1)

      // Replacing keeps exactly one.
      await section.getByLabel(input).setInputFiles({ name: `${kind.toLowerCase()}-2.png`, mimeType: 'image/png', buffer: PNG })
      await expect(toast(page, uploaded)).toBeVisible()
      await expect.poll(async () => (await listMedia()).filter((m) => m.kind === kind).length).toBe(1)

      acceptNextConfirm(page)
      await section.getByRole('button', { name: 'Remove' }).click()
      await expect(toast(page, removed)).toBeVisible()
      await expect(section.getByRole('img', { name: alt })).toHaveCount(0)
      expect((await listMedia()).filter((m) => m.kind === kind)).toHaveLength(0)
    }
    crashes.assertNone()
  })

  test('a file that is not really an image is refused', async ({ page }) => {
    await openSection(page, munId, 'documents', 'Documents & Media')
    const section = page.getByTestId('branding-LOGO')
    await section
      .getByLabel('Logo image (max 2MB)')
      .setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not a png') })
    await expect(section.getByRole('img', { name: 'Current logo' })).toHaveCount(0)
    expect((await listMedia()).filter((m) => m.kind === 'LOGO')).toHaveLength(0)
  })
})

test('a mislabelled upload is refused by the API (magic bytes)', async () => {
  const res = await api.post(`muns/${munId}/media`, {
    data: { kind: 'LOGO', contentType: 'image/png', fileBase64: Buffer.from('GIF89a not a png').toString('base64') },
  })
  expect(res.status()).toBe(400)
})

test('upload a logo and cover; only the owner can see or delete them before the MUN is public', async () => {
  const logo = await upload('LOGO')
  const cover = await upload('COVER')
  expect(logo.kind).toBe('LOGO')
  expect(logo.url).toBeTruthy()
  expect((await listMedia()).map((m) => m.id)).toEqual(expect.arrayContaining([logo.id, cover.id]))

  // The sandbox isn't published, so its media is hidden from the public (270680b).
  const anon = await anonApi()
  expect((await anon.get(`muns/${munId}/media`)).status()).toBe(404)
  expect((await anon.delete(`media/${logo.id}`)).status()).toBe(401)
  await anon.dispose()

  expect((await api.delete(`media/${logo.id}`)).status()).toBe(204)
  expect((await api.delete(`media/${cover.id}`)).status()).toBe(204)
  const remaining = (await listMedia()).map((m) => m.id)
  expect(remaining).not.toContain(logo.id)
  expect(remaining).not.toContain(cover.id)
})

test('reorder the gallery', async () => {
  const a = await upload('GALLERY', 0)
  const b = await upload('GALLERY', 1)
  const res = await api.post(`muns/${munId}/media/actions/reorder-gallery`, { data: { orderedIds: [b.id, a.id] } })
  expect(res.status()).toBe(204)
  const gallery = (await listMedia()).filter((m) => m.kind === 'GALLERY').sort((x, y) => x.displayOrder - y.displayOrder)
  expect(gallery.map((m) => m.id)).toEqual([b.id, a.id])
  await api.delete(`media/${a.id}`)
  await api.delete(`media/${b.id}`)
})

test('reordering with an id from elsewhere is a client error, not a server error', async () => {
  const a = await upload('GALLERY', 0)
  const res = await api.post(`muns/${munId}/media/actions/reorder-gallery`, {
    data: { orderedIds: [a.id, crypto.randomUUID()] },
  })
  await api.delete(`media/${a.id}`)
  expect(res.status()).toBe(400)
})

test('only PNG, JPEG and WebP images of a known kind are accepted', async () => {
  for (const data of [
    { kind: 'LOGO', contentType: 'image/gif', fileBase64: PNG.toString('base64') },
    { kind: 'LOGO', contentType: 'application/pdf', fileBase64: PNG.toString('base64') },
    { kind: 'MASCOT', contentType: 'image/png', fileBase64: PNG.toString('base64') },
    { kind: 'LOGO', contentType: 'image/png', fileBase64: '' },
  ]) {
    expect((await api.post(`muns/${munId}/media`, { data })).status(), `${data.kind} ${data.contentType}`).toBe(400)
  }
})
