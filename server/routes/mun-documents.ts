import { Hono } from 'hono'
import { z } from 'zod'
import { deleteMunDocument, listMunDocuments, uploadMunDocument } from '@/lib/actions/mun-documents'
import { munDocumentKindEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const uploadDocumentBodySchema = z
  .object({
    kind: z.enum(munDocumentKindEnum.enumValues),
    title: z.string().min(1),
    contentType: z.literal('application/pdf'),
    fileBase64: z.string().min(1),
  })
  .strict()

export const munDocumentsRoutes = new Hono<{ Variables: AppVariables }>()

munDocumentsRoutes.get('/muns/:munId/documents', async (c) => {
  const documents = await listMunDocuments(c.req.param('munId'))
  return c.json(documents)
})

munDocumentsRoutes.post(
  '/muns/:munId/documents',
  requireAuth,
  zValidator('json', uploadDocumentBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const document = await uploadMunDocument(
      {
        munId: c.req.param('munId'),
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
