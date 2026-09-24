import { Hono } from 'hono'
import { z } from 'zod'
import {
  deleteMunMedia,
  listMunMedia,
  MEDIA_UPLOAD_PURPOSE,
  reorderGallery,
  uploadMunMedia,
} from '@/lib/actions/mun-branding'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
import { assertCanUploadToMun } from '@/lib/actions/upload-limits'
import { munMediaKindEnum } from '@/lib/db/schema-enums'
import { largestUploadBytes, maxBase64Length } from '@/lib/storage/validate'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

// The largest media file (a 5MB cover or gallery image). The per-kind cap
// (logos 2MB) is enforced after decoding, in lib/storage/validate.ts.
const MEDIA_MAX_BYTES = largestUploadBytes(Object.values(MEDIA_UPLOAD_PURPOSE))

const uploadMediaBodySchema = z
  .object({
    kind: z.enum(munMediaKindEnum.enumValues),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    fileBase64: z
      .string()
      .min(1)
      .max(
        maxBase64Length(MEDIA_MAX_BYTES),
        `File too large — maximum allowed size is ${MEDIA_MAX_BYTES / (1024 * 1024)}MB`,
      ),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

const reorderGalleryBodySchema = z
  .object({
    orderedIds: z.array(z.string().uuid()),
  })
  .strict()

export const munBrandingRoutes = new Hono<{ Variables: AppVariables }>()

// Published MUNs for anyone; unpublished ones for the owner and staff only
// (404 otherwise) — same session-dependent-URL hazard as the other by-id
// module reads, so only the resolved-'public' case may carry a shared
// Cache-Control; owner/staff gets no-store. TTL matches the mun detail page
// (muns.ts's MUN_DETAIL_CACHE) — logo/cover/gallery images change about as
// often as the rest of the detail content.
const MUN_MEDIA_CACHE = 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'

munBrandingRoutes.get('/muns/:munId/media', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const media = await listMunMedia(munId)
  c.header('Cache-Control', access === 'public' ? MUN_MEDIA_CACHE : 'no-store')
  return c.json(media)
})

munBrandingRoutes.post(
  '/muns/:munId/media',
  requireAuth,
  // Ownership and Gate-1 approval before the body is parsed or decoded, so a
  // caller who may not upload here never gets megabytes of base64 processed.
  async (c, next) => {
    await assertCanUploadToMun(c.req.param('munId'), c.get('session'))
    await next()
  },
  zValidator('json', uploadMediaBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const munId = c.req.param('munId')
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
