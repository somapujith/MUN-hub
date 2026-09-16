import { Hono } from 'hono'
import { z } from 'zod'
import { getAccountSettings, setEmailNotificationsEnabled } from '@/lib/actions/account'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const updateNotificationsBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

export const accountRoutes = new Hono<{ Variables: AppVariables }>()

accountRoutes.get('/account', requireAuth, async (c) => {
  const settings = await getAccountSettings(c.get('session')!)
  return c.json(settings)
})

accountRoutes.patch(
  '/account/notifications',
  requireAuth,
  zValidator('json', updateNotificationsBodySchema),
  async (c) => {
    const { enabled } = c.req.valid('json')
    await setEmailNotificationsEnabled(enabled, c.get('session')!)
    return c.body(null, 204)
  },
)
