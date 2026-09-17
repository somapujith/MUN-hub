import { Hono } from 'hono'
import { z } from 'zod'
import { checkInDelegate, getRegistrationPass } from '@/lib/actions/check-in'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const checkInBodySchema = z
  .object({
    // Loose on purpose: the lib canonicalises spacing, case and look-alike
    // characters, and answers a malformed code with a helpful message.
    code: z.string().min(1).max(64),
  })
  .strict()

export const checkInRoutes = new Hono<{ Variables: AppVariables }>()

/** Door check-in by pass code — owning organizer or platform staff. */
checkInRoutes.post('/organizer/muns/:munId/check-in', requireAuth, zValidator('json', checkInBodySchema), async (c) => {
  const result = await checkInDelegate(c.req.param('munId'), c.req.valid('json').code, c.get('session'))
  return c.json(result)
})

/** The signed-in delegate's own pass (with its check-in code). */
checkInRoutes.get('/me/registrations/:registrationId/pass', requireAuth, async (c) => {
  const pass = await getRegistrationPass(c.req.param('registrationId'), c.get('session'))
  c.header('Cache-Control', 'no-store')
  return c.json(pass)
})
