import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { SESSION_COOKIE_NAME, SESSION_MAX_LIFETIME_MS, getSessionByToken } from '@/lib/auth/session'
import { GUARDIAN_CONSENT_REQUIRED } from '@/lib/actions/auth'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import { mapThrownError } from '../middleware/error'
import { TURNSTILE_MESSAGES, TURNSTILE_SITEVERIFY_URL } from '../lib/turnstile'
import { resolveResetAppUrl } from '../routes/password-reset'
import { sessionCookieSecure } from '../routes/auth'
import { createApp } from '../src/app'

const app = createApp()
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const ENV_KEYS = ['COOKIE_SECURE', 'TURNSTILE_SECRET_KEY', 'NODE_ENV', 'APP_URL'] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
}

beforeAll(() => {
  // app.request() has no client address, so every request here shares one
  // rate-limit bucket ('unknown'); lift the per-IP limits for this file.
  process.env.RATE_LIMIT_IP_MULTIPLIER = '1000'
})

afterAll(async () => {
  delete process.env.RATE_LIMIT_IP_MULTIPLIER
})

afterEach(() => {
  restoreEnv()
  vi.restoreAllMocks()
})

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  })
}

function sessionTokenFrom(response: Response): string {
  const token = response.headers.get('set-cookie')?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1]
  if (!token) throw new Error('no session cookie set')
  return token
}

function uniqueEmail(label: string) {
  return `${label}-${crypto.randomUUID()}@test.com`
}

async function makePasswordUser(password = 'route-password-1') {
  const [user] = await db
    .insert(users)
    .values({ name: 'Route User', email: uniqueEmail('route-user'), role: 'STUDENT', passwordHash: await hashPassword(password) })
    .returning()
  return { user, password }
}

async function signInVia(email: string, password: string) {
  const res = await post('/auth/session', { email, password })
  expect(res.status).toBe(200)
  return sessionTokenFrom(res)
}

function birthDate(yearsAgo: number): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - yearsAgo, now.getUTCMonth(), now.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10)
}

function signUpBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Route Signup',
    email: uniqueEmail('route-signup'),
    password: 'route-signup-password',
    gender: 'Prefer not to say',
    phone: '9990001111',
    institution: 'Route University',
    dateOfBirth: birthDate(20),
    gradeOrYear: '2nd year',
    residentialAddress: '1 Route Street',
    emergencyContactName: 'Route Guardian',
    emergencyContactPhone: '9990002222',
    emergencyContactRelation: 'Parent',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
    ...overrides,
  }
}

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax and lives for the absolute session lifetime', async () => {
    const { user, password } = await makePasswordUser()
    const res = await post('/auth/session', { email: user.email, password })

    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_LIFETIME_MS / 1000}`)
    // app.request() talks plain http to localhost: no Secure flag by default.
    expect(cookie).not.toContain('Secure')
  })

  it('is Secure when COOKIE_SECURE=true, even on localhost', async () => {
    process.env.COOKIE_SECURE = 'true'
    const { user, password } = await makePasswordUser()
    const res = await post('/auth/session', { email: user.email, password })

    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('sessionCookieSecure: Secure by default except plain-http loopback; COOKIE_SECURE decides outright', () => {
    expect(sessionCookieSecure('https://api.munhub.in/api/v1/auth/session')).toBe(true)
    expect(sessionCookieSecure('http://api.munhub.in/api/v1/auth/session')).toBe(true)
    expect(sessionCookieSecure('http://localhost:3001/api/v1/auth/session')).toBe(false)
    expect(sessionCookieSecure('http://127.0.0.1:3001/api/v1/auth/session')).toBe(false)
    expect(sessionCookieSecure('http://[::1]:3001/api/v1/auth/session')).toBe(false)

    process.env.COOKIE_SECURE = 'false'
    expect(sessionCookieSecure('https://api.munhub.in/')).toBe(false)
    process.env.COOKIE_SECURE = 'TRUE'
    expect(sessionCookieSecure('http://localhost:3001/')).toBe(true)
  })
})

describe('POST /auth/session/password', () => {
  it('keeps the calling session and signs out every other one', async () => {
    const { user, password } = await makePasswordUser()
    const current = await signInVia(user.email, password)
    const otherDevice = await signInVia(user.email, password)

    const res = await post(
      '/auth/session/password',
      { currentPassword: password, newPassword: 'route-password-2' },
      { Cookie: `${SESSION_COOKIE_NAME}=${current}` },
    )

    expect(res.status).toBe(204)
    expect(await getSessionByToken(current)).toMatchObject({ userId: user.id })
    expect(await getSessionByToken(otherDevice)).toBeNull()
  })
})

describe('POST /auth/users guardian consent', () => {
  it('rejects an under-18 signup without the guardian acknowledgement with a clear 400', async () => {
    const res = await post('/auth/users', signUpBody({ dateOfBirth: birthDate(16) }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: GUARDIAN_CONSENT_REQUIRED },
    })
  })

  it('accepts an under-18 signup that carries the acknowledgement', async () => {
    const res = await post(
      '/auth/users',
      signUpBody({ dateOfBirth: birthDate(16), acceptedGuardianAcknowledgement: true }),
    )
    expect(res.status).toBe(201)
  })

  it('maps the guardian error to 400 in the shared error taxonomy', () => {
    expect(mapThrownError(new Error(GUARDIAN_CONSENT_REQUIRED))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
  })
})

describe('Turnstile', () => {
  let fetchSpy: MockInstance<typeof fetch>
  let sendSpy: MockInstance<(notification: NotificationPayload) => Promise<void>>

  function siteverifyAnswers(body: Record<string, unknown>) {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    sendSpy = vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
  })

  it('is skipped entirely when TURNSTILE_SECRET_KEY is unset', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const res = await post('/auth/users', signUpBody())

    expect(res.status).toBe(201)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  describe('with TURNSTILE_SECRET_KEY set', () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret'
    })

    it('rejects a signup without a token and creates no account', async () => {
      const body = signUpBody()
      const res = await post('/auth/users', body)

      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe(TURNSTILE_MESSAGES.missing)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(await db.select().from(users).where(eq(users.email, body.email))).toHaveLength(0)
    })

    it('accepts a signup whose token siteverify confirms for the signup action', async () => {
      siteverifyAnswers({ success: true, action: 'delegate-signup' })
      const res = await post('/auth/users', signUpBody({ turnstileToken: 'good-token' }))

      expect(res.status).toBe(201)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe(TURNSTILE_SITEVERIFY_URL)
      expect(JSON.parse(String(init?.body))).toMatchObject({ secret: 'test-turnstile-secret', response: 'good-token' })
    })

    it('rejects a token siteverify refuses', async () => {
      siteverifyAnswers({ success: false, 'error-codes': ['invalid-input-response'] })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const res = await post('/auth/users', signUpBody({ turnstileToken: 'bad-token' }))

      expect(res.status).toBe(400)
      expect((await res.json()).error.message).toBe(TURNSTILE_MESSAGES.failed)
    })

    it('rejects a token minted for a different form', async () => {
      siteverifyAnswers({ success: true, action: 'organizer-code' })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const res = await post('/auth/users', signUpBody({ turnstileToken: 'other-form-token' }))

      expect(res.status).toBe(400)
    })

    it('fails closed with 503 when siteverify is unreachable', async () => {
      fetchSpy.mockRejectedValue(new Error('network down'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const res = await post('/auth/users', signUpBody({ turnstileToken: 'any-token' }))

      expect(res.status).toBe(503)
      expect((await res.json()).error).toMatchObject({ code: 'UNAVAILABLE', message: TURNSTILE_MESSAGES.unavailable })
    })

    it('guards organizer code requests too', async () => {
      const email = uniqueEmail('turnstile-org')
      const missing = await post('/auth/organizers/code', { email })
      expect(missing.status).toBe(400)
      expect(sendSpy).not.toHaveBeenCalled()

      siteverifyAnswers({ success: true, action: 'organizer-code' })
      const passed = await post('/auth/organizers/code', { email, turnstileToken: 'good-token' })
      expect(passed.status).toBe(204)
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    it('does not guard password sign-in', async () => {
      const { user, password } = await makePasswordUser()
      const res = await post('/auth/session', { email: user.email, password })
      expect(res.status).toBe(200)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})

describe('password-reset links', () => {
  let sendSpy: MockInstance<(notification: NotificationPayload) => Promise<void>>

  beforeEach(() => {
    sendSpy = vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
  })

  async function requestLinkFor(origin?: string) {
    const { user } = await makePasswordUser()
    const res = await post('/password-reset/request', { email: user.email }, origin ? { Origin: origin } : {})
    expect(res.status).toBe(204)
    return sendSpy.mock.calls.at(-1)?.[0].body.match(/(\S+)\/reset-password\?token=/)?.[1]
  }

  it('never builds the link from an untrusted Origin', async () => {
    process.env.APP_URL = 'https://munhub.in'
    expect(await requestLinkFor('https://evil.example')).toBe('https://munhub.in')
  })

  it('uses a loopback Origin in local development', async () => {
    process.env.APP_URL = 'https://munhub.in'
    expect(await requestLinkFor('http://localhost:5174')).toBe('http://localhost:5174')
  })

  it('resolveResetAppUrl: production always uses APP_URL and refuses to guess', () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_URL = 'https://munhub.in/'
    expect(resolveResetAppUrl('http://localhost:5173')).toBe('https://munhub.in')
    expect(resolveResetAppUrl('https://evil.example')).toBe('https://munhub.in')

    delete process.env.APP_URL
    expect(() => resolveResetAppUrl('https://munhub.in')).toThrow(/APP_URL/)
  })

  it('resolveResetAppUrl: development falls back to APP_URL, then the Vite dev URL', () => {
    process.env.NODE_ENV = 'development'
    process.env.APP_URL = 'http://localhost:3000'
    expect(resolveResetAppUrl('https://evil.example')).toBe('http://localhost:3000')
    expect(resolveResetAppUrl('http://localhost.evil.example')).toBe('http://localhost:3000')
    delete process.env.APP_URL
    expect(resolveResetAppUrl(undefined)).toBe('http://localhost:5173')
  })

  it('a confirmed reset ends every session and the link cannot be replayed', async () => {
    const { user, password } = await makePasswordUser()
    const session = await signInVia(user.email, password)
    await post('/password-reset/request', { email: user.email })
    const token = sendSpy.mock.calls.at(-1)?.[0].body.match(/reset-password\?token=([0-9a-f]+)/)?.[1]

    const confirm = await post('/password-reset/confirm', { token, newPassword: 'route-reset-password' })
    expect(confirm.status).toBe(204)
    expect(await getSessionByToken(session)).toBeNull()

    const replay = await post('/password-reset/confirm', { token, newPassword: 'route-reset-password-2' })
    expect(replay.status).toBe(400)
    expect((await replay.json()).error.message).toBe('This reset link is invalid or has expired')
  })
})
