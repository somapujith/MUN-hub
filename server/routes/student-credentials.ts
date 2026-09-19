import { Hono } from 'hono'
import { listMyCredentials } from '@/lib/actions/student-credentials'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

export const studentCredentialsRoutes = new Hono<{ Variables: AppVariables }>()

/** The signed-in delegate's own verified awards and certificates. */
studentCredentialsRoutes.get('/me/credentials', requireAuth, async (c) => {
  const credentials = await listMyCredentials(c.get('session'))
  // Per-user data behind a cookie: never let a shared cache keep it.
  c.header('Cache-Control', 'no-store')
  return c.json(credentials)
})
