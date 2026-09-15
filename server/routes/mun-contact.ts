import { Hono } from 'hono'
import { z } from 'zod'
import { getMunContact, upsertMunContact } from '@/lib/actions/mun-contact'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const upsertContactBodySchema = z
  .object({
    officialEmail: z.string().email(),
    phone: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    socialLinks: z.unknown().optional(),
    contactPersonName: z.string().min(1),
    contactPersonRole: z.string().nullable().optional(),
    contactPersonEmail: z.string().email(),
    contactPersonPhone: z.string().nullable().optional(),
  })
  .strict()

export const munContactRoutes = new Hono<{ Variables: AppVariables }>()

munContactRoutes.get('/muns/:munId/contact', async (c) => {
  const contact = await getMunContact(c.req.param('munId'))
  return c.json(contact)
})

munContactRoutes.put(
  '/muns/:munId/contact',
  requireAuth,
  zValidator('json', upsertContactBodySchema),
  async (c) => {
    const contact = await upsertMunContact(
      c.req.param('munId'),
      c.req.valid('json'),
      c.get('session'),
    )
    return c.json(contact, 200)
  },
)
