import fs from 'node:fs'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitBinding } from '../lib/rate-limit-store'
import type { AppVariables } from '../src/types'
import { LIMITERS, rateLimitMiddleware } from './rate-limit'

const app = new Hono<{ Variables: AppVariables }>()
// Stand-in for sessionMiddleware: the test names the signed-in user directly.
app.use('*', async (c, next) => {
  const userId = c.req.header('x-test-user')
  c.set('session', userId ? { userId, role: 'STUDENT' } : null)
  await next()
})
app.use('/api/v1/*', rateLimitMiddleware)
app.all('/api/v1/*', (c) => c.json({ ok: true }))

let ipCounter = 0
/** A fresh client address per call site, so tests never share in-memory buckets. */
function freshIp(): string {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

function freshEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@test.dev`
}

interface SendOptions {
  ip: string
  method?: string
  body?: unknown
  user?: string
  env?: Record<string, unknown>
}

/** Sends through app.fetch with a Workers-style `cf` object, so CF-Connecting-IP is the client address. */
async function send(route: string, { ip, method = 'POST', body, user, env = {} }: SendOptions): Promise<Response> {
  const request = new Request(`http://api.test/api/v1${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
      ...(user ? { 'x-test-user': user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  Object.defineProperty(request, 'cf', { value: { country: 'IN' } })
  return app.fetch(request, env)
}

async function statuses(count: number, makeRequest: (i: number) => Promise<Response>): Promise<number[]> {
  const result: number[] = []
  for (let i = 0; i < count; i += 1) result.push((await makeRequest(i)).status)
  return result
}

function allowedThenBlocked(allowed: number, blocked = 1): number[] {
  return [...Array(allowed).fill(200), ...Array(blocked).fill(429)]
}

afterEach(() => {
  delete process.env.RATE_LIMIT_GLOBAL_PER_MINUTE
  delete process.env.RATE_LIMIT_IP_MULTIPLIER
})

describe('rateLimitMiddleware (in-memory fallback)', () => {
  describe('password sign-in', () => {
    it('limits attempts per account, whichever addresses they come from', async () => {
      const email = freshEmail('login-account')
      const result = await statuses(LIMITERS.loginAccount.limit + 1, () =>
        send('/auth/session', { ip: freshIp(), body: { email, password: 'guess' } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.loginAccount.limit))
    })

    it('treats email case and surrounding spaces as the same account', async () => {
      const email = freshEmail('login-case')
      const variants = [email, email.toUpperCase(), ` ${email} `]
      const result = await statuses(LIMITERS.loginAccount.limit + 1, (i) =>
        send('/auth/session', { ip: freshIp(), body: { email: variants[i % variants.length], password: 'x' } }),
      )
      expect(result.at(-1)).toBe(429)
    })

    it('limits attempts per IP across many accounts (password spraying)', async () => {
      const ip = freshIp()
      const result = await statuses(LIMITERS.loginIp.limit + 1, () =>
        send('/auth/session', { ip, body: { email: freshEmail('spray'), password: 'Winter2026!' } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.loginIp.limit))
    })

    it('still applies the per-IP limit when the body has no usable email', async () => {
      const ip = freshIp()
      const result = await statuses(LIMITERS.loginIp.limit + 1, () => send('/auth/session', { ip, body: 'not json' }))
      expect(result.at(-1)).toBe(429)
    })
  })

  it('a route rule does not exempt a request from the global per-IP cap', async () => {
    process.env.RATE_LIMIT_GLOBAL_PER_MINUTE = '3'
    const ip = freshIp()

    expect(await statuses(3, () => send('/muns', { ip, method: 'GET' }))).toEqual([200, 200, 200])
    // Neither login limit is anywhere near exhausted, but the global cap is.
    const login = await send('/auth/session', { ip, body: { email: freshEmail('global'), password: 'x' } })
    expect(login.status).toBe(429)
    // Other addresses are unaffected.
    expect((await send('/muns', { ip: freshIp(), method: 'GET' })).status).toBe(200)
  })

  it('limits signups per IP', async () => {
    const ip = freshIp()
    const result = await statuses(LIMITERS.signupIp.limit + 1, () => send('/auth/users', { ip, body: {} }))
    expect(result).toEqual(allowedThenBlocked(LIMITERS.signupIp.limit))
    expect((await send('/auth/users', { ip: freshIp(), body: {} })).status).toBe(200)
  })

  describe('password reset', () => {
    it('limits reset requests per email, from any address', async () => {
      const email = freshEmail('reset-email')
      const result = await statuses(LIMITERS.resetRequestEmail.limit + 1, () =>
        send('/password-reset/request', { ip: freshIp(), body: { email } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.resetRequestEmail.limit))
    })

    it('limits reset requests per IP across emails', async () => {
      const ip = freshIp()
      const result = await statuses(LIMITERS.resetRequestIp.limit + 1, () =>
        send('/password-reset/request', { ip, body: { email: freshEmail('reset-ip') } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.resetRequestIp.limit))
    })

    it('limits reset confirmations per IP', async () => {
      const ip = freshIp()
      const result = await statuses(LIMITERS.resetConfirmIp.limit + 1, () =>
        send('/password-reset/confirm', { ip, body: { token: 'x', newPassword: 'y' } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.resetConfirmIp.limit))
    })
  })

  describe('verification email resend', () => {
    it('limits resends per email, from any address', async () => {
      const email = freshEmail('verify-email')
      const result = await statuses(LIMITERS.verifyResendEmail.limit + 1, (i) =>
        send('/verify-email/resend', { ip: freshIp(), body: { email: i % 2 ? email.toUpperCase() : email } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.verifyResendEmail.limit))
    })

    it('limits resends per IP across emails', async () => {
      const ip = freshIp()
      const result = await statuses(LIMITERS.verifyResendIp.limit + 1, () =>
        send('/verify-email/resend', { ip, body: { email: freshEmail('verify-ip') } }),
      )
      expect(result).toEqual(allowedThenBlocked(LIMITERS.verifyResendIp.limit))
    })
  })

  it('limits password changes per signed-in user, not per address', async () => {
    const user = `user-${crypto.randomUUID()}`
    const result = await statuses(LIMITERS.changePasswordUser.limit + 1, () =>
      send('/auth/session/password', { ip: freshIp(), user, body: {} }),
    )
    expect(result).toEqual(allowedThenBlocked(LIMITERS.changePasswordUser.limit))

    const otherUser = await send('/auth/session/password', { ip: freshIp(), user: `user-${crypto.randomUUID()}`, body: {} })
    expect(otherUser.status).toBe(200)
  })

  it('keeps the organizer code limits: per IP+email and per IP', async () => {
    const ip = freshIp()
    const email = freshEmail('org-code')
    expect(
      await statuses(LIMITERS.organizerCodeIpEmail.limit + 1, () => send('/auth/organizers/code', { ip, body: { email } })),
    ).toEqual(allowedThenBlocked(LIMITERS.organizerCodeIpEmail.limit))

    const sprayIp = freshIp()
    const spray = await statuses(LIMITERS.organizerCodeIp.limit + 1, () =>
      send('/auth/organizers/code', { ip: sprayIp, body: { email: freshEmail('org-spray') } }),
    )
    expect(spray.at(-1)).toBe(429)
    expect(spray.slice(0, -1).every((status) => status === 200)).toBe(true)
  })

  it('answers 429 with Retry-After and the RATE_LIMITED error body', async () => {
    const ip = freshIp()
    let last: Response | undefined
    for (let i = 0; i <= LIMITERS.signupIp.limit; i += 1) last = await send('/auth/users', { ip, body: {} })

    expect(last!.status).toBe(429)
    const retryAfter = Number(last!.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expect(await last!.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } })
  })

  it('RATE_LIMIT_IP_MULTIPLIER scales per-IP limits only', async () => {
    process.env.RATE_LIMIT_IP_MULTIPLIER = '2'

    const ip = freshIp()
    const signups = await statuses(LIMITERS.signupIp.limit * 2 + 1, () => send('/auth/users', { ip, body: {} }))
    expect(signups).toEqual(allowedThenBlocked(LIMITERS.signupIp.limit * 2))

    const email = freshEmail('multiplier')
    const logins = await statuses(LIMITERS.loginAccount.limit + 1, () =>
      send('/auth/session', { ip: freshIp(), body: { email, password: 'x' } }),
    )
    expect(logins).toEqual(allowedThenBlocked(LIMITERS.loginAccount.limit))
  })
})

describe('rateLimitMiddleware (Workers bindings)', () => {
  function fakeBinding(allow: (key: string) => boolean = () => true) {
    return { limit: vi.fn(async ({ key }: { key: string }) => ({ success: allow(key) })) } satisfies RateLimitBinding
  }

  function allBindings() {
    return Object.fromEntries(Object.values(LIMITERS).map((spec) => [spec.binding, fakeBinding()]))
  }

  it('counts a login against the global, per-IP and per-account bindings', async () => {
    const env = allBindings()
    const ip = freshIp()
    const email = freshEmail('binding-login')

    const res = await send('/auth/session', { ip, env, body: { email: email.toUpperCase(), password: 'x' } })

    expect(res.status).toBe(200)
    expect((env.RL_GLOBAL_IP as ReturnType<typeof fakeBinding>).limit).toHaveBeenCalledWith({ key: `ip:${ip}` })
    expect((env.RL_LOGIN_IP as ReturnType<typeof fakeBinding>).limit).toHaveBeenCalledWith({ key: `ip:${ip}` })
    expect((env.RL_LOGIN_ACCOUNT as ReturnType<typeof fakeBinding>).limit).toHaveBeenCalledWith({
      key: `email:${email}`,
    })
    expect((env.RL_SIGNUP_IP as ReturnType<typeof fakeBinding>).limit).not.toHaveBeenCalled()
  })

  it('uses the binding instead of the in-memory counter when present', async () => {
    const env = allBindings()
    const ip = freshIp()
    const result = await statuses(LIMITERS.signupIp.limit * 3, () => send('/auth/users', { ip, env, body: {} }))
    expect(result.every((status) => status === 200)).toBe(true)
  })

  it('answers 429 with the binding period as Retry-After when a binding refuses', async () => {
    const email = freshEmail('binding-denied')
    const env = { ...allBindings(), RL_LOGIN_ACCOUNT: fakeBinding((key) => key !== `email:${email}`) }

    const res = await send('/auth/session', { ip: freshIp(), env, body: { email, password: 'x' } })

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe(String(LIMITERS.loginAccount.periodSeconds))
  })

  it('refuses on the global binding even for routes with their own rule', async () => {
    const env: Record<string, ReturnType<typeof fakeBinding>> = {
      ...allBindings(),
      RL_GLOBAL_IP: fakeBinding(() => false),
    }
    const res = await send('/auth/users', { ip: freshIp(), env, body: {} })
    expect(res.status).toBe(429)
    expect(env.RL_SIGNUP_IP.limit).not.toHaveBeenCalled()
  })

  it('falls back to the in-memory counter when a binding call throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = {
      ...allBindings(),
      RL_SIGNUP_IP: { limit: vi.fn(async () => Promise.reject(new Error('binding unavailable'))) },
    }
    const ip = freshIp()

    const result = await statuses(LIMITERS.signupIp.limit + 1, () => send('/auth/users', { ip, env, body: {} }))

    expect(result).toEqual(allowedThenBlocked(LIMITERS.signupIp.limit))
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('ignores the in-memory overrides when bindings are present', async () => {
    process.env.RATE_LIMIT_GLOBAL_PER_MINUTE = '1'
    const env = allBindings()
    const ip = freshIp()
    expect(await statuses(3, () => send('/muns', { ip, env, method: 'GET' }))).toEqual([200, 200, 200])
  })
})

describe('server/wrangler.jsonc ratelimits', () => {
  /** Strips // and block comments outside strings, then trailing commas. */
  function parseJsonc(text: string): unknown {
    let out = ''
    let inString = false
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i]
      if (inString) {
        out += char
        if (char === '\\') out += text[++i]
        else if (char === '"') inString = false
      } else if (char === '"') {
        inString = true
        out += char
      } else if (char === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i += 1
        out += '\n'
      } else if (char === '/' && text[i + 1] === '*') {
        i = text.indexOf('*/', i + 2) + 1
      } else {
        out += char
      }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  }

  const config = parseJsonc(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
    ratelimits?: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>
  }
  const declared = config.ratelimits ?? []

  it('declares a binding with the same limit and period for every limiter', () => {
    for (const spec of Object.values(LIMITERS)) {
      const binding = declared.find((entry) => entry.name === spec.binding)
      expect(binding, spec.binding).toBeDefined()
      expect(binding!.simple, spec.binding).toEqual({ limit: spec.limit, period: spec.periodSeconds })
    }
    expect(declared).toHaveLength(Object.keys(LIMITERS).length)
  })

  it('uses unique, positive-integer namespace ids', () => {
    const ids = declared.map((entry) => entry.namespace_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[1-9]\d*$/)
  })

  it('only uses periods Workers supports', () => {
    for (const entry of declared) expect([10, 60]).toContain(entry.simple.period)
  })
})
