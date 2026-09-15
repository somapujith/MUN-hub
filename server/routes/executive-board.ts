import { Hono } from 'hono'
import { z } from 'zod'
import {
  createEbMember,
  deleteEbMember,
  listEbMembers,
  listEbMembersForOrganizer,
  updateEbMember,
} from '@/lib/actions/executive-board'
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

executiveBoardRoutes.get('/muns/:munId/executive-board', async (c) => {
  const members = await listEbMembers(c.req.param('munId'))
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
