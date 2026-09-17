import { expect, test, type APIRequestContext } from '@playwright/test'
import { anonApi, organizerApi, sandboxId } from './_helpers'

/**
 * Branding & Media module (Onboarding PRD §11: logo + cover required).
 * There is no branding UI in the workspace, so this covers the API only.
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

test.fixme('branding (logo, cover, gallery) can be managed from the workspace', async () => {
  // PRD §11 requires a logo and cover image, and the Branding module is a
  // required go-live module, but no workspace section offers an upload UI —
  // an organizer cannot complete it without the API.
})

test('upload a logo and cover, list them publicly, then delete them', async () => {
  const logo = await upload('LOGO')
  const cover = await upload('COVER')
  expect(logo.kind).toBe('LOGO')
  expect(logo.url).toBeTruthy()

  const anon = await anonApi()
  const publicMedia: Media[] = await (await anon.get(`muns/${munId}/media`)).json()
  expect(publicMedia.map((m) => m.id)).toEqual(expect.arrayContaining([logo.id, cover.id]))
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
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: lib/actions/mun-branding.ts#reorderGallery throws "One or more ids do not belong to this mun", which server/middleware/error.ts does not map, so the API answers 500 instead of 400')
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
