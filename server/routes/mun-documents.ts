import { Hono } from 'hono'
import { z } from 'zod'
import { deleteMunDocument, listMunDocuments, uploadMunDocument } from '@/lib/actions/mun-documents'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { munDocumentKindEnum } from '@/lib/db/schema-enums'
import { base64LengthForBytes, UPLOAD_RULES } from '@/lib/storage/validate'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

// Capped at the document byte limit once base64-encoded, so the schema
// rejects an oversized payload before the handler decodes it.
const uploadDocumentBodySchema = z
  .object({
    kind: z.enum(munDocumentKindEnum.enumValues),
    title: z.string().min(1),
    contentType: z.literal('application/pdf'),
    fileBase64: z.string().min(1).max(base64LengthForBytes(UPLOAD_RULES.DOCUMENT.maxBytes)),
  })
  .strict()

export const munDocumentsRoutes = new Hono<{ Variables: AppVariables }>()

// Published MUNs for anyone; unpublished ones for the owner and staff only (404 otherwise).
munDocumentsRoutes.get('/muns/:munId/documents', async (c) => {
  const munId = c.req.param('munId')
  await assertMunReadable(munId, c.get('session'))
  const documents = await listMunDocuments(munId)
  return c.json(documents)
})

munDocumentsRoutes.post(
  '/muns/:munId/documents',
  requireAuth,
  zValidator('json', uploadDocumentBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const munId = c.req.param('munId')
    // Ownership first, decode second: uploadMunDocument checks this again,
    // but building the Buffer here would let anyone signed in spend the
    // isolate's memory on a MUN they have no access to.
    await assertOwnsOrAdmin(munId, c.get('session'))
    const document = await uploadMunDocument(
      {
        munId,
        kind: body.kind,
        title: body.title,
        contentType: body.contentType,
        file: Buffer.from(body.fileBase64, 'base64'),
      },
      c.get('session'),
    )
    return c.json(document, 201)
  },
)

munDocumentsRoutes.delete('/documents/:documentId', requireAuth, async (c) => {
  await deleteMunDocument(c.req.param('documentId'), c.get('session'))
  return c.body(null, 204)
})
