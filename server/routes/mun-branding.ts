import { Hono } from 'hono'
import { z } from 'zod'
import { deleteMunMedia, listMunMedia, reorderGallery, uploadMunMedia } from '@/lib/actions/mun-branding'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { munMediaKindEnum } from '@/lib/db/schema-enums'
import { base64LengthForBytes, MAX_IMAGE_UPLOAD_BYTES } from '@/lib/storage/validate'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

// Capped at the largest image any kind allows, so the schema rejects an
// oversized payload before the handler decodes it (the per-kind byte cap in
// lib/storage/validate.ts only applies once a Buffer already exists).
const uploadMediaBodySchema = z
  .object({
    kind: z.enum(munMediaKindEnum.enumValues),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    fileBase64: z.string().min(1).max(base64LengthForBytes(MAX_IMAGE_UPLOAD_BYTES)),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

const reorderGalleryBodySchema = z
  .object({
    orderedIds: z.array(z.string().uuid()),
  })
  .strict()

export const munBrandingRoutes = new Hono<{ Variables: AppVariables }>()

// Published MUNs for anyone; unpublished ones for the owner and staff only (404 otherwise).
munBrandingRoutes.get('/muns/:munId/media', async (c) => {
  const munId = c.req.param('munId')
  await assertMunReadable(munId, c.get('session'))
  const media = await listMunMedia(munId)
  return c.json(media)
})

munBrandingRoutes.post(
  '/muns/:munId/media',
  requireAuth,
  zValidator('json', uploadMediaBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const munId = c.req.param('munId')
    // Ownership first, decode second: uploadMunMedia checks this again, but
    // building the Buffer here would let anyone signed in spend the isolate's
    // memory on a MUN they have no access to.
    await assertOwnsOrAdmin(munId, c.get('session'))
    const media = await uploadMunMedia(
      {
        munId,
        kind: body.kind,
        contentType: body.contentType,
        file: Buffer.from(body.fileBase64, 'base64'),
        displayOrder: body.displayOrder,
      },
      c.get('session'),
    )
    return c.json(media, 201)
  },
)

munBrandingRoutes.delete('/media/:mediaId', requireAuth, async (c) => {
  await deleteMunMedia(c.req.param('mediaId'), c.get('session'))
  return c.body(null, 204)
})

munBrandingRoutes.post(
  '/muns/:munId/media/actions/reorder-gallery',
  requireAuth,
  zValidator('json', reorderGalleryBodySchema),
  async (c) => {
    await reorderGallery(c.req.param('munId'), c.req.valid('json').orderedIds, c.get('session'))
    return c.body(null, 204)
  },
)
