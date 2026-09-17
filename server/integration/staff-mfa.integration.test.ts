import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { totp } from '@/lib/auth/totp'
import { createApp } from '../src/app'

const app = createApp()
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const PASSWORD = 'a-strong-staff-password'

async function makeStaff(role: 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN') {
  const [user] = await db
    .insert(users)
    .values({ name: `staff-${role}`, email: `staff-mfa-${crypto.randomUUID()}@test.dev`, role, passwordHash: await hashPassword(PASSWORD) })
    .returning()
  return user
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) })
}

function get(path: string, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, { headers })
}

function cookieHeader(res: Response): Record<string, string> {
  const cookie = res.headers.get('set-cookie')?.split(';')[0]
  return cookie ? { Cookie: cookie } : {}
}

/** Full enroll-and-confirm round trip over HTTP, returning cookies + secret. */
async function enrollViaHttp(staff: { id: string; email: string }) {
  const signIn = await post('/auth/session', { email: staff.email, password: PASSWORD })
  const auth = cookieHeader(signIn)

  const setup = await post('/auth/mfa/setup', {}, auth)
  const { secret } = (await setup.json()) as { secret: string }

  const confirm = await post('/auth/mfa/confirm', { code: totp(secret) }, auth)
  expect(confirm.status).toBe(200)

  return { auth, secret }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /auth/session — staff MFA branch', () => {
  it('a staff account with no confirmed MFA signs in directly, exactly like before MFA existed', async () => {
    const staff = await makeStaff()

    const res = await post('/auth/session', { email: staff.email, password: PASSWORD })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'SIGNED_IN', userId: staff.id, role: 'ADMIN' })
    expect(res.headers.get('set-cookie')).toContain('mun_hub_session=')
  })

  it('a staff account with confirmed MFA gets MFA_REQUIRED and no cookie, then completes via /auth/session/mfa', async () => {
    const staff = await makeStaff('OPERATIONS')
    const { secret } = await enrollViaHttp(staff)

    const signIn = await post('/auth/session', { email: staff.email, password: PASSWORD })
    expect(signIn.status).toBe(200)
    const body = (await signIn.json()) as { status: string; pendingToken: string }
    expect(body.status).toBe('MFA_REQUIRED')
    expect(signIn.headers.get('set-cookie')).toBeNull()

    // The confirmation step above already consumed the current TOTP step.
    const challenge = await post('/auth/session/mfa', { pendingToken: body.pendingToken, code: totp(secret, new Date(Date.now() + 30_000)) })

    expect(challenge.status).toBe(200)
    expect(await challenge.json()).toEqual({ status: 'SIGNED_IN', userId: staff.id, role: 'OPERATIONS' })
    expect(challenge.headers.get('set-cookie')).toContain('mun_hub_session=')
  })

  it('rejects a wrong code on the challenge endpoint with 401', async () => {
    const staff = await makeStaff()
    await enrollViaHttp(staff)

    const signIn = await post('/auth/session', { email: staff.email, password: PASSWORD })
    const { pendingToken } = (await signIn.json()) as { pendingToken: string }

    const res = await post('/auth/session/mfa', { pendingToken, code: '000000' })

    expect(res.status).toBe(401)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })
})

describe('staff-role routes + REQUIRE_STAFF_2FA', () => {
  it('unset (default): a staff account with no MFA can still reach a staff-only route', async () => {
    const staff = await makeStaff()
    const signIn = await post('/auth/session', { email: staff.email, password: PASSWORD })
    const auth = cookieHeader(signIn)

    const res = await get('/admin/staff', auth)

    expect(res.status).toBe(200)
  })

  it('REQUIRE_STAFF_2FA=true: blocks a staff account with no confirmed MFA from a staff-only route', async () => {
    const staff = await makeStaff()
    const signIn = await post('/auth/session', { email: staff.email, password: PASSWORD })
    const auth = cookieHeader(signIn)

    vi.stubEnv('REQUIRE_STAFF_2FA', 'true')
    const res = await get('/admin/staff', auth)

    expect(res.status).toBe(403)
  })

  it('REQUIRE_STAFF_2FA=true: still lets that same account reach the enrollment routes (requireAuth only)', async () => {
    const staff = await makeStaff()
    const signIn = await post('/auth/session', { email: staff.email, password: PASSWORD })
    const auth = cookieHeader(signIn)

    vi.stubEnv('REQUIRE_STAFF_2FA', 'true')
    const status = await get('/auth/mfa/status', auth)
    const setup = await post('/auth/mfa/setup', {}, auth)

    expect(status.status).toBe(200)
    expect(setup.status).toBe(200)
  })

  it('REQUIRE_STAFF_2FA=true: a staff account that has confirmed MFA reaches a staff-only route after completing the challenge', async () => {
    const staff = await makeStaff()
    const { secret } = await enrollViaHttp(staff)

    const signInAgain = await post('/auth/session', { email: staff.email, password: PASSWORD })
    const { pendingToken } = (await signInAgain.json()) as { pendingToken: string }
    const challenge = await post('/auth/session/mfa', { pendingToken, code: totp(secret, new Date(Date.now() + 30_000)) })
    const auth = cookieHeader(challenge)

    vi.stubEnv('REQUIRE_STAFF_2FA', 'true')
    const res = await get('/admin/staff', auth)

    expect(res.status).toBe(200)
  })
})
