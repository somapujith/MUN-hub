import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { getSessionByToken, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import type { AppVariables } from '../src/types'

export const sessionMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME) ?? ''
  const session = token ? await getSessionByToken(token) : null
  c.set('session', session)
  await next()
})
