import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { z } from 'zod'
import { getAccountSettings, setEmailNotificationsEnabled } from '@/lib/actions/account'
import { ACCOUNT_DELETION_ERRORS, deleteOwnAccount } from '@/lib/actions/account-deletion'
import { exportAccountData } from '@/lib/actions/data-export'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const updateNotificationsBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

// `confirmation` is checked for the exact word in lib, so a wrong value gets
// that module's message rather than a generic schema error.
const deleteAccountBodySchema = z
  .object({
    confirmation: z.string(),
    password: z.string().min(1),
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

// "Download my data" — lib/actions/data-export.ts. Sent as an attachment so a
// plain navigation also saves a file; never cached, it's personal data.
accountRoutes.get('/account/export', requireAuth, async (c) => {
  const data = await exportAccountData(c.get('session')!)
  const date = data.exportedAt.toISOString().slice(0, 10)
  c.header('Content-Disposition', `attachment; filename="munhub-data-${date}.json"`)
  c.header('Cache-Control', 'no-store')
  return c.json(data)
})

// Self-service account deletion — lib/actions/account-deletion.ts. The lib's
// own messages are mapped here rather than in middleware/error.ts, which
// several lanes are editing at once.
accountRoutes.post(
  '/account/delete',
  requireAuth,
  zValidator('json', deleteAccountBodySchema),
  async (c) => {
    const body = c.req.valid('json')

    try {
      await deleteOwnAccount(body, c.get('session')!)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === ACCOUNT_DELETION_ERRORS.confirmation) {
        return c.json({ error: { code: 'VALIDATION_FAILED', message } }, 400)
      }
      if (message === ACCOUNT_DELETION_ERRORS.password) {
        return c.json({ error: { code: 'UNAUTHORIZED', message } }, 401)
      }
      if (message === ACCOUNT_DELETION_ERRORS.notSelfService) {
        return c.json({ error: { code: 'FORBIDDEN', message } }, 403)
      }
      throw error
    }

    // Same attributes the sign-in route sets the cookie with (server/routes/
    // auth.ts), or the browser keeps it. The session row is already gone.
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', domain: getRuntimeEnv('COOKIE_DOMAIN') || undefined })
    return c.body(null, 204)
  },
)
