import { expect, test, type APIRequestContext } from '@playwright/test'
import { totp } from '../../../lib/auth/totp'
import { newApiContext } from '../../fixtures/api'
import { uniqueEmail } from '../../fixtures/data'
import { createStaffUser, retireStaffUsers } from '../../fixtures/fixture-db'
import { createStaffSession } from '../admin/_helpers'

/**
 * Staff TOTP two-factor sign-in (900f476, e6a0db9), through the API. The E2E
 * API runs without REQUIRE_STAFF_2FA, so unenrolled staff sign in as before;
 * an enrolled account is always challenged. Each test uses fresh staff
 * accounts (login is limited to 5/min per account).
 */

test.describe.configure({ mode: 'serial' })

const created: string[] = []

test.afterAll(async () => {
  await retireStaffUsers(created)
})

async function freshAdmin() {
  const user = await createStaffUser('ADMIN', { email: uniqueEmail('mfa-admin'), name: `E2E MFA Admin ${Date.now()}` })
  created.push(user.email)
  return user
}

async function signIn(email: string, password: string) {
  const api = await newApiContext()
  const res = await api.post('auth/session', { data: { email, password } })
  return { api, res }
}

/** Enrolls `api`'s signed-in account; returns the secret, the step used, and the recovery codes. */
async function enroll(api: APIRequestContext) {
  expect(await (await api.get('auth/mfa/status')).json()).toEqual({ confirmed: false })
  const setup = await api.post('auth/mfa/setup')
  expect(setup.status(), await setup.text()).toBe(200)
  const { secret, otpauthUri } = (await setup.json()) as { secret: string; otpauthUri: string }
  expect(secret).toMatch(/^[A-Z2-7]+=*$/)
  expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//)
  expect(otpauthUri).toContain(`secret=${secret}`)

  expect((await api.post('auth/mfa/confirm', { data: { code: '000000' } })).status()).toBe(401)
  const confirm = await api.post('auth/mfa/confirm', { data: { code: totp(secret) } })
  expect(confirm.status(), await confirm.text()).toBe(200)
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] }
  expect(recoveryCodes).toHaveLength(10)
  for (const code of recoveryCodes) expect(code).toMatch(/^[0-9a-fA-F]{5}-[0-9a-fA-F]{5}$/)
  expect(new Set(recoveryCodes).size).toBe(10)

  expect(await (await api.get('auth/mfa/status')).json()).toEqual({ confirmed: true })
  expect((await api.post('auth/mfa/setup')).status()).toBe(409)
  expect((await api.post('auth/mfa/confirm', { data: { code: totp(secret) } })).status()).toBe(409)
  return { secret, recoveryCodes }
}

test('without enrollment, staff sign in in one step', async () => {
  const user = await freshAdmin()
  const { api, res } = await signIn(user.email, user.password)
  expect(res.status()).toBe(200)
  expect(await res.json()).toMatchObject({ status: 'SIGNED_IN', role: 'ADMIN' })
  expect((await api.get('admin/overview')).status()).toBe(200)
  await api.dispose()
})

test('an enrolled admin must pass the code step; a code and a recovery code each work, once', async () => {
  const user = await freshAdmin()
  const first = await signIn(user.email, user.password)
  const { secret, recoveryCodes } = await enroll(first.api)
  await first.api.dispose()

  // Password alone no longer signs in, and sets no cookie.
  const challenged = await signIn(user.email, user.password)
  expect(challenged.res.status()).toBe(200)
  const body = await challenged.res.json()
  expect(body).toMatchObject({ status: 'MFA_REQUIRED' })
  expect(body.pendingToken).toBeTruthy()
  expect(challenged.res.headers()['set-cookie'] ?? '').not.toMatch(/session/i)
  expect(await (await challenged.api.get('auth/session')).json()).toBeNull()

  // The confirm step already used the current time step, so answer with the next one.
  const nextStepCode = totp(secret, new Date(Date.now() + 30_000))
  const wrong = await challenged.api.post('auth/session/mfa', { data: { pendingToken: body.pendingToken, code: '123456' } })
  expect(wrong.status()).toBe(401)
  const ok = await challenged.api.post('auth/session/mfa', { data: { pendingToken: body.pendingToken, code: nextStepCode } })
  expect(ok.status(), await ok.text()).toBe(200)
  expect(await ok.json()).toMatchObject({ status: 'SIGNED_IN', role: 'ADMIN' })
  expect((await challenged.api.get('admin/overview')).status()).toBe(200)
  // The pending token is spent.
  const reused = await challenged.api.post('auth/session/mfa', { data: { pendingToken: body.pendingToken, code: nextStepCode } })
  expect(reused.status()).toBeGreaterThanOrEqual(400)
  await challenged.api.dispose()

  // A recovery code works once.
  const again = await signIn(user.email, user.password)
  const token = (await again.res.json()).pendingToken
  const recovered = await again.api.post('auth/session/mfa', { data: { pendingToken: token, code: recoveryCodes[0] } })
  expect(recovered.status(), await recovered.text()).toBe(200)
  await again.api.dispose()

  const thirdTry = await signIn(user.email, user.password)
  const token3 = (await thirdTry.res.json()).pendingToken
  const spent = await thirdTry.api.post('auth/session/mfa', { data: { pendingToken: token3, code: recoveryCodes[0] } })
  expect(spent.status()).toBe(401)
  await thirdTry.api.dispose()
})

test('a bogus pending token is refused, and five wrong codes lock the challenge', async () => {
  const anon = await newApiContext()
  const bogus = await anon.post('auth/session/mfa', { data: { pendingToken: 'not-a-real-token', code: '123456' } })
  expect(bogus.status()).toBe(400)
  expect((await bogus.json()).error.code).toBe('VALIDATION_FAILED')
  expect((await anon.post('auth/session/mfa', { data: { code: '123456' } })).status()).toBe(400)
  await anon.dispose()

  const user = await freshAdmin()
  const first = await signIn(user.email, user.password)
  const { secret } = await enroll(first.api)
  await first.api.dispose()

  const challenged = await signIn(user.email, user.password)
  const { pendingToken } = await challenged.res.json()
  const statuses: number[] = []
  for (let i = 0; i < 6; i += 1) {
    statuses.push((await challenged.api.post('auth/session/mfa', { data: { pendingToken, code: '000000' } })).status())
  }
  expect(statuses.slice(0, 5).every((s) => s === 401 || s === 429)).toBe(true)
  expect(statuses.at(-1)).toBe(429)
  // Even the right code is refused once the challenge is locked.
  const locked = await challenged.api.post('auth/session/mfa', {
    data: { pendingToken, code: totp(secret, new Date(Date.now() + 30_000)) },
  })
  expect(locked.status()).toBe(429)
  expect(await (await challenged.api.get('auth/session')).json()).toBeNull()
  await challenged.api.dispose()
})

test('only a super admin can reset a lost device, and the account signs in plainly again', async () => {
  const user = await freshAdmin()
  const first = await signIn(user.email, user.password)
  await enroll(first.api)

  // An ADMIN (even the account itself) can't reset.
  expect((await first.api.post(`admin/staff/${(await (await first.api.get('auth/session')).json()).userId}/mfa/reset`)).status()).toBe(403)
  const userId = (await (await first.api.get('auth/session')).json()).userId as string
  await first.api.dispose()

  const superAdmin = await createStaffSession('SUPER_ADMIN')
  created.push(superAdmin.email)
  const reset = await superAdmin.api.post(`admin/staff/${userId}/mfa/reset`)
  expect(reset.status(), await reset.text()).toBe(204)
  await superAdmin.api.dispose()

  const plain = await signIn(user.email, user.password)
  expect(await plain.res.json()).toMatchObject({ status: 'SIGNED_IN' })
  expect(await (await plain.api.get('auth/mfa/status')).json()).toEqual({ confirmed: false })
  await plain.api.dispose()
})

test('students and organizers are never challenged, and enrollment needs a session', async () => {
  const anon = await newApiContext()
  expect((await anon.get('auth/mfa/status')).status()).toBe(401)
  expect((await anon.post('auth/mfa/setup')).status()).toBe(401)
  expect((await anon.post('auth/mfa/confirm', { data: { code: '123456' } })).status()).toBe(401)
  await anon.dispose()
})
