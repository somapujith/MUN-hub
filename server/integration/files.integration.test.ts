import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { createInMemoryKv, SAMPLE_FILES } from '@/lib/storage/in-memory-bindings'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

// Upload through the real routes with a KV binding, then fetch the returned
// URL from the files route: the round trip the web app depends on.

const app = createApp()

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Files API Mun', slug: `files-api-${crypto.randomUUID()}`, status: 'ONBOARDING' })
    .returning()
  return mun
}

async function setup() {
  const organizer = await makeUser('ORGANIZER')
  const mun = await makeMun(organizer.id)
  const headers = { ...(await authHeaders(organizer.id)), 'Content-Type': 'application/json' }
  const kv = createInMemoryKv()
  return { mun, headers, kv, env: { UPLOADS_KV: kv } }
}

function pathOf(url: string): string {
  return new URL(url).pathname
}

describe('uploads served by /api/v1/files', () => {
  // runtimeEnvMiddleware keeps the last request's env in a module variable;
  // don't let one test's PUBLIC_API_URL leak into the next.
  afterEach(() => setRuntimeEnv({}))

  it('uploads a logo, serves it back from the returned URL, and 404s after delete', async () => {
    const { mun, headers, kv, env } = await setup()

    const upload = await app.request(
      `/api/v1/muns/${mun.id}/media`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'LOGO', contentType: 'image/png', fileBase64: SAMPLE_FILES.png.toString('base64') }),
      },
      env,
    )
    expect(upload.status, await upload.clone().text()).toBe(201)
    const media = (await upload.json()) as { id: string; url: string; storageKey: string }

    // Absolute URL on the API's origin (app.request uses http://localhost).
    expect(media.url).toBe(`http://localhost/api/v1/files/${media.storageKey}`)
    expect(kv.entries.has(media.storageKey)).toBe(true)

    const file = await app.request(pathOf(media.url), {}, env)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await file.arrayBuffer()).equals(SAMPLE_FILES.png)).toBe(true)

    // The MUN is unpublished, so only its owner (or staff) may list its media.
    const listed = (await (await app.request(`/api/v1/muns/${mun.id}/media`, { headers }, env)).json()) as Array<{
      url: string
    }>
    expect(listed.map((m) => m.url)).toEqual([media.url])

    const removed = await app.request(`/api/v1/media/${media.id}`, { method: 'DELETE', headers }, env)
    expect(removed.status).toBe(204)
    expect(kv.entries.has(media.storageKey)).toBe(false)
    expect((await app.request(pathOf(media.url), {}, env)).status).toBe(404)
  })

  it('uploads a PDF document and serves it back inline', async () => {
    const { mun, headers, env } = await setup()

    const upload = await app.request(
      `/api/v1/muns/${mun.id}/documents`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'RULES',
          title: 'Rules of Procedure',
          contentType: 'application/pdf',
          fileBase64: SAMPLE_FILES.pdf.toString('base64'),
        }),
      },
      env,
    )
    expect(upload.status, await upload.clone().text()).toBe(201)
    const doc = (await upload.json()) as { url: string }

    const file = await app.request(pathOf(doc.url), {}, env)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('application/pdf')
    expect(file.headers.get('Content-Disposition')).toMatch(/^inline; filename=".+\.pdf"$/)
    expect(Buffer.from(await file.arrayBuffer()).equals(SAMPLE_FILES.pdf)).toBe(true)
  })

  it('uses PUBLIC_API_URL for the returned URL when it is configured', async () => {
    const { mun, headers, env } = await setup()

    const upload = await app.request(
      `/api/v1/muns/${mun.id}/media`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'COVER', contentType: 'image/webp', fileBase64: SAMPLE_FILES.webp.toString('base64') }),
      },
      { ...env, PUBLIC_API_URL: 'https://api.munhub.in' },
    )
    expect(upload.status).toBe(201)
    const media = (await upload.json()) as { url: string; storageKey: string }
    expect(media.url).toBe(`https://api.munhub.in/api/v1/files/${media.storageKey}`)
  })

  it('rejects mislabelled or oversized uploads with 400 VALIDATION_FAILED and stores nothing', async () => {
    const { mun, headers, kv, env } = await setup()

    const mislabelled = await app.request(
      `/api/v1/muns/${mun.id}/media`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'LOGO', contentType: 'image/png', fileBase64: SAMPLE_FILES.svg.toString('base64') }),
      },
      env,
    )
    expect(mislabelled.status).toBe(400)
    expect(await mislabelled.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: "The file's contents do not match its declared type (image/png) — a valid PNG image is required",
      },
    })

    const bigLogo = Buffer.alloc(2 * 1024 * 1024 + 1)
    SAMPLE_FILES.png.copy(bigLogo)
    const oversized = await app.request(
      `/api/v1/muns/${mun.id}/media`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'LOGO', contentType: 'image/png', fileBase64: bigLogo.toString('base64') }),
      },
      env,
    )
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('maximum allowed size is 2MB') },
    })

    const notPdf = await app.request(
      `/api/v1/muns/${mun.id}/documents`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'RULES',
          title: 'Rules',
          contentType: 'application/pdf',
          fileBase64: SAMPLE_FILES.html.toString('base64'),
        }),
      },
      env,
    )
    expect(notPdf.status).toBe(400)
    expect(await notPdf.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })

    expect(kv.entries.size).toBe(0)
  })
})

afterAll(async () => {
  await db.$client.end()
})
