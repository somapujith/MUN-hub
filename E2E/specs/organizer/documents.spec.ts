import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
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

/** Documents & Media — Rules & Documents module (Onboarding PRD §22). Sandbox only; uploads are removed again. */

const REGION = 'Uploaded documents'
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

interface MunDocument {
  id: string
  title: string
  kind: string
  url: string
  sizeBytes: number
}

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  for (const doc of await listDocuments()) {
    if (doc.title.startsWith('E2E ')) await api.delete(`documents/${doc.id}`)
  }
  await api?.dispose()
})

async function listDocuments(): Promise<MunDocument[]> {
  const res = await api.get(`muns/${munId}/documents`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function openDocuments(page: Page) {
  await openSection(page, munId, 'documents', 'Documents')
}

test.describe('documents UI', () => {
  test('upload a PDF, see it listed with a download link, then delete it', async ({ page }) => {
    const title = `E2E Handbook ${uid()}`
    await openDocuments(page)

    const form = main(page).locator('form')
    await form.getByLabel('Title').fill(title)
    await form.getByLabel('Type').selectOption({ label: 'Handbook' })
    await form.getByLabel('PDF file (max 20MB)').setInputFiles({ name: 'handbook.pdf', mimeType: 'application/pdf', buffer: PDF })
    await form.getByRole('button', { name: 'Upload' }).click()

    await expect(toast(page, 'Document uploaded')).toBeVisible()
    const card = cardFor(page, REGION, title)
    await expect(card).toContainText('Handbook')
    await expect(card).toContainText(/\d+ B · Uploaded/)
    const saved = (await listDocuments()).find((d) => d.title === title)!
    expect(saved).toMatchObject({ kind: 'HANDBOOK', sizeBytes: PDF.byteLength })
    // A link styled as a button, so its role is button.
    await expect(main(page).getByRole('button', { name: `Download ${title}` })).toHaveAttribute('href', saved.url)
    // The form resets after a successful upload.
    await expect(form.getByLabel('Title')).toHaveValue('')

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Delete ${title}` }).click()
    await expect(main(page).getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    expect((await listDocuments()).map((d) => d.id)).not.toContain(saved.id)
  })

  test('only PDFs are accepted, and a title is required', async ({ page }) => {
    await openDocuments(page)
    const form = main(page).locator('form')
    await form.evaluate((el) => el.setAttribute('novalidate', ''))

    await form.getByLabel('PDF file (max 20MB)').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('not a pdf') })
    await expect(toast(page, 'Only PDF files are allowed')).toBeVisible()

    await form.getByLabel('PDF file (max 20MB)').setInputFiles({ name: 'rules.pdf', mimeType: 'application/pdf', buffer: PDF })
    await form.getByRole('button', { name: 'Upload' }).click()
    await expect(toast(page, 'Title is required')).toBeVisible()

    const title = `E2E No File ${uid()}`
    await form.getByLabel('Title').fill(title)
    await form.getByLabel('PDF file (max 20MB)').setInputFiles([])
    await form.getByRole('button', { name: 'Upload' }).click()
    await expect(toast(page, 'Choose a PDF to upload')).toBeVisible()
    expect((await listDocuments()).map((d) => d.title)).not.toContain(title)
  })
})

test.describe('documents API', () => {
  test('upload, list publicly, and delete a PDF', async () => {
    const title = `E2E Rules ${uid()}`
    const res = await api.post(`muns/${munId}/documents`, {
      data: { kind: 'RULES', title, contentType: 'application/pdf', fileBase64: PDF.toString('base64') },
    })
    expect(res.status(), await res.text()).toBe(201)
    const doc: MunDocument = await res.json()

    const anon = await anonApi()
    const publicDocs: MunDocument[] = await (await anon.get(`muns/${munId}/documents`)).json()
    expect(publicDocs.map((d) => d.id)).toContain(doc.id)
    // Only the owner may delete.
    expect((await anon.delete(`documents/${doc.id}`)).status()).toBe(401)
    await anon.dispose()

    expect((await api.delete(`documents/${doc.id}`)).status()).toBe(204)
    expect((await api.delete(`documents/${doc.id}`)).status()).toBe(404)
  })

  test('non-PDF uploads and unknown kinds are refused', async () => {
    for (const data of [
      { kind: 'RULES', title: 'E2E x', contentType: 'image/png', fileBase64: 'aGVsbG8=' },
      { kind: 'MEMES', title: 'E2E x', contentType: 'application/pdf', fileBase64: PDF.toString('base64') },
      { kind: 'RULES', title: '', contentType: 'application/pdf', fileBase64: PDF.toString('base64') },
      { kind: 'RULES', title: 'E2E x', contentType: 'application/pdf', fileBase64: '' },
    ]) {
      expect((await api.post(`muns/${munId}/documents`, { data })).status(), JSON.stringify({ ...data, fileBase64: '…' })).toBe(400)
    }
  })
})
