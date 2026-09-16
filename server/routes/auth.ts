import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { changePassword, signIn, signOut, signUp } from '@/lib/actions/auth'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

// Unset locally (host-only cookie, today's behavior). In production, set to
// ".munhub.in" so the session cookie is sent to app./organize./admin. too.
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §5
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined

const signInBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
    password: z.string().min(1),
  })
  .strict()

const signUpBodySchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().min(1).email(),
    password: z.string().min(8),
  })
  .strict()

const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .strict()

export const authRoutes = new Hono<{ Variables: AppVariables }>()

function setSessionCookie(c: Context<{ Variables: AppVariables }>, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    domain: COOKIE_DOMAIN,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    expires: expiresAt,
  })
}

authRoutes.post('/session', async (c) => {
  const body = signInBodySchema.parse(await c.req.json())
  const { userId, role, token, expiresAt } = await signIn(body.email, body.password)

  setSessionCookie(c, token, expiresAt)

  return c.json({ userId, role })
})

authRoutes.post('/users', async (c) => {
  const body = signUpBodySchema.parse(await c.req.json())
  const { userId, role, token, expiresAt } = await signUp(body.name, body.email, body.password)

  setSessionCookie(c, token, expiresAt)

  return c.json({ userId, role }, 201)
})

// Session-gated "change password while logged in" — see lib/actions/auth.ts's
// changePassword for how this differs from the signed-out reset flow in
// server/routes/password-reset.ts (which invalidates other sessions; this
// does not).
authRoutes.post('/session/password', requireAuth, async (c) => {
  const body = changePasswordBodySchema.parse(await c.req.json())
  await changePassword(body.currentPassword, body.newPassword, c.get('session')!)

  return c.body(null, 204)
})

authRoutes.delete('/session', async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME) ?? ''
  await signOut(token)

  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', domain: COOKIE_DOMAIN })

  return c.body(null, 204)
})

authRoutes.get('/session', (c) => {
  const session = c.get('session')
  return c.json(session)
})
