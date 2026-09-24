import { Hono } from 'hono'
import { z } from 'zod'
import {
  createEbMember,
  deleteEbMember,
  listEbMembers,
  listEbMembersForOrganizer,
  removeEbMemberPhoto,
  updateEbMember,
  uploadEbMemberPhoto,
} from '@/lib/actions/executive-board'
import { assertMunReadable } from '@/lib/actions/mun-read-access'
import { ebRoleEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const createEbBodySchema = z
  .object({
    committeeId: z.string().uuid().nullable().optional(),
    name: z.string().min(1),
    role: z.enum(ebRoleEnum.enumValues),
    customRole: z.string().nullable().optional(),
    photoUrl: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    institution: z.string().nullable().optional(),
    organization: z.string().nullable().optional(),
    socialLinks: z.unknown().optional(),
    isPublic: z.boolean().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.role === 'CUSTOM' && (!data.customRole || data.customRole.trim().length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'customRole is required when role is CUSTOM', path: ['customRole'] })
    }
  })

const updateEbBodySchema = z
  .object({
    committeeId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).optional(),
    role: z.enum(ebRoleEnum.enumValues).optional(),
    customRole: z.string().nullable().optional(),
    photoUrl: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    institution: z.string().nullable().optional(),
    organization: z.string().nullable().optional(),
    socialLinks: z.unknown().optional(),
    isPublic: z.boolean().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
  })
  .strict()

export const executiveBoardRoutes = new Hono<{ Variables: AppVariables }>()

// listEbMembers only ever returns isPublic=true rows (hidden members: see
// /manage below), so the body is the same for a published MUN regardless of
// caller. But assertMunReadable itself is session-dependent for an
// unpublished MUN (owner/staff get 200, everyone else 404 on the exact same
// URL) — so only the resolved-'public' case (published mun) may carry a
// shared Cache-Control; the owner/staff case must say no-store, or a shared
// cache could later serve an anonymous visitor the owner's preview of an
// unpublished MUN. TTL matches muns.ts's MUN_DETAIL_CACHE — board membership
// changes about as often as the rest of the mun detail page.
const EXECUTIVE_BOARD_CACHE = 'public, max-age=120, s-maxage=600, stale-while-revalidate=1800'

executiveBoardRoutes.get('/muns/:munId/executive-board', async (c) => {
  const munId = c.req.param('munId')
  const access = await assertMunReadable(munId, c.get('session'))
  const members = await listEbMembers(munId)
  c.header('Cache-Control', access === 'public' ? EXECUTIVE_BOARD_CACHE : 'no-store')
  return c.json(members)
})

executiveBoardRoutes.get('/muns/:munId/executive-board/manage', requireAuth, async (c) => {
  const members = await listEbMembersForOrganizer(c.req.param('munId'), c.get('session'))
  return c.json(members)
})

executiveBoardRoutes.post(
  '/muns/:munId/executive-board',
  requireAuth,
  zValidator('json', createEbBodySchema),
  async (c) => {
    const member = await createEbMember(
      { ...c.req.valid('json'), munId: c.req.param('munId') },
      c.get('session'),
    )
    return c.json(member, 201)
  },
)

executiveBoardRoutes.patch(
  '/executive-board/:memberId',
  requireAuth,
  zValidator('json', updateEbBodySchema),
  async (c) => {
    const member = await updateEbMember(c.req.param('memberId'), c.req.valid('json'), c.get('session'))
    return c.json(member)
  },
)

executiveBoardRoutes.delete('/executive-board/:memberId', requireAuth, async (c) => {
  await deleteEbMember(c.req.param('memberId'), c.get('session'))
  return c.body(null, 204)
})

const uploadPhotoBodySchema = z
  .object({
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    fileBase64: z.string().min(1),
  })
  .strict()

executiveBoardRoutes.post(
  '/executive-board/:memberId/photo',
  requireAuth,
  zValidator('json', uploadPhotoBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const member = await uploadEbMemberPhoto(
      c.req.param('memberId'),
      Buffer.from(body.fileBase64, 'base64'),
      body.contentType,
      c.get('session'),
    )
    return c.json(member)
  },
)

executiveBoardRoutes.delete('/executive-board/:memberId/photo', requireAuth, async (c) => {
  return c.json(await removeEbMemberPhoto(c.req.param('memberId'), c.get('session')))
})
