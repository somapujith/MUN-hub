import { Hono } from 'hono'
import { z } from 'zod'
import { deleteMunDocument, listMunDocuments, uploadMunDocument } from '@/lib/actions/mun-documents'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
import { assertCanUploadToMun } from '@/lib/actions/upload-limits'
import { munDocumentKindEnum } from '@/lib/db/schema-enums'
import { assertModuleNotLocked } from '@/lib/lifecycle/module-completion'
import { maxBase64Length, UPLOAD_RULES } from '@/lib/storage/validate'
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
    fileBase64: z
      .string()
      .min(1)
      .max(
        maxBase64Length(UPLOAD_RULES.DOCUMENT.maxBytes),
        `File too large — maximum allowed size is ${UPLOAD_RULES.DOCUMENT.maxLabel}`,
      ),
  })
  .strict()

export const munDocumentsRoutes = new Hono<{ Variables: AppVariables }>()

// Published MUNs for anyone; unpublished ones for the owner and staff only
// (404 otherwise) — assertMunReadable's result varies by session for the same
// URL when the mun isn't public yet, so only the resolved-'public' case may
// carry a shared Cache-Control (same reasoning as muns.ts's
// includeInactive=true guard); the owner/staff case is no-store. Rules/
// background-guide PDFs change rarely once uploaded — a document is added,
// not edited in place — so this gets a longer TTL than the mun detail page,
// matching the FAQ list's reasoning (mun-faq.ts).
const MUN_DOCUMENTS_CACHE = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600'

munDocumentsRoutes.get('/muns/:munId/documents', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const documents = await listMunDocuments(munId)
  c.header('Cache-Control', access === 'public' ? MUN_DOCUMENTS_CACHE : 'no-store')
  return c.json(documents)
})

munDocumentsRoutes.post(
  '/muns/:munId/documents',
  requireAuth,
  // Ownership, Gate-1 approval and the review lock before the body is parsed
  // or decoded, so a caller who may not upload here never gets megabytes of
  // base64 processed. uploadMunDocument repeats these checks.
  async (c, next) => {
    const munId = c.req.param('munId')
    const session = c.get('session')
    await assertCanUploadToMun(munId, session)
    await assertModuleNotLocked(munId, 'RULES_DOCUMENTS', session)
    await next()
  },
  zValidator('json', uploadDocumentBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const munId = c.req.param('munId')
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
