import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { signIn, signOut } from '@/lib/actions/auth'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import type { AppVariables } from '../src/types'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const signInBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
  })
  .strict()

export const authRoutes = new Hono<{ Variables: AppVariables }>()

authRoutes.post('/session', async (c) => {
  const body = signInBodySchema.parse(await c.req.json())
  const { userId, role, token, expiresAt } = await signIn(body.email)

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    expires: expiresAt,
  })

  return c.json({ userId, role })
})

authRoutes.delete('/session', async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME) ?? ''
  await signOut(token)

  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })

  return c.body(null, 204)
})

authRoutes.get('/session', (c) => {
  const session = c.get('session')
  return c.json(session)
})
