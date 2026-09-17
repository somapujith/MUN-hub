import { expect, request, test } from '@playwright/test'
import { API_ORIGIN, API_URL, WEB_URL } from '../../env'
import { DEMO_PASSWORD, OTHER_ORGANIZER_EMAIL } from '../../fixtures/accounts'
import {
  TEST_LOGIN_CODE,
  getMun,
  newApiContext,
  seedOrganizerLoginCode,
  signInViaApi,
  signUpViaApi,
} from '../../fixtures/api'
import { signUpPayload, uniqueEmail } from '../../fixtures/data'
import { CLOSED } from '../../fixtures/fixture-muns'

/**
 * Cross-cutting API security controls (PRD §33, §37). Pure API tests — no
 * browser — so they're fast and precise about status codes.
 */

const EVIL_ORIGIN = 'https://evil.example'

test.describe('authentication', () => {
  test('protected endpoints refuse anonymous callers', async () => {
    const api = await newApiContext()
    for (const path of ['profile', 'account', 'me/registrations/upcoming', 'organizer/workspace/overview']) {
      const res = await api.get(path)
      expect(res.status(), `GET ${path}`).toBe(401)
    }
    const res = await api.post('registrations', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { munId: crypto.randomUUID(), registrationProductId: crypto.randomUUID() },
    })
    expect(res.status()).toBe(401)
  })

  test('the session endpoint reports null when signed out', async () => {
    const api = await newApiContext()
    const res = await api.get('auth/session')
    expect(res.status()).toBe(200)
    expect(await res.json()).toBeNull()
  })

  test('the session cookie is HttpOnly, SameSite=Lax and site-wide', async () => {
    const api = await newApiContext()
    const payload = signUpPayload()
    const res = await api.post('auth/users', { data: payload })
    expect(res.status()).toBe(201)
    const cookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? ''
    expect(cookie).toMatch(/^mun_hub_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)
  })

  test('signing out invalidates the session server-side, not just the cookie', async () => {
    const session = await signUpViaApi()
    const cookies = (await session.api.storageState()).cookies
    expect((await session.api.get('profile')).status()).toBe(200)

    expect((await session.api.delete('auth/session')).status()).toBe(204)

    // Replay the old cookie from a fresh client: the server must have forgotten it.
    const replay = await request.newContext({
      baseURL: `${API_URL}/`,
      extraHTTPHeaders: { Origin: WEB_URL },
      storageState: { cookies, origins: [] },
    })
    expect((await replay.get('profile')).status()).toBe(401)
  })

  test('wrong password and unknown email are indistinguishable', async () => {
    const api = await newApiContext()
    const known = await api.post('auth/session', { data: { email: 'student@munhub.test', password: 'definitely-wrong' } })
    const unknown = await api.post('auth/session', { data: { email: uniqueEmail('nobody'), password: 'definitely-wrong' } })
    expect(known.status()).toBe(401)
    expect(unknown.status()).toBe(known.status())
    expect((await unknown.json()).error.message).toBe((await known.json()).error.message)
  })

  test('login attempts are rate-limited per email', async () => {
    const api = await newApiContext()
    const email = uniqueEmail('bruteforce')
    const statuses: number[] = []
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await api.post('auth/session', { data: { email, password: `guess-${i}` } })).status())
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
  })

  test('password-reset requests do not reveal whether an account exists', async () => {
    const api = await newApiContext()
    const known = await api.post('password-reset/request', { data: { email: 'student@munhub.test' } })
    const unknown = await api.post('password-reset/request', { data: { email: uniqueEmail('ghost') } })
    expect(unknown.status()).toBe(known.status())
    expect(await unknown.text()).toBe(await known.text())
  })
})

test.describe('mass assignment', () => {
  test('signup cannot smuggle a role', async () => {
    const api = await newApiContext()
    const res = await api.post('auth/users', { data: { ...signUpPayload(), role: 'ADMIN' } })
    expect(res.status()).toBe(400)
  })

  test('organizer signup cannot smuggle a role either', async () => {
    const email = uniqueEmail('sneaky')
    // A valid code, so the only reason to refuse is the extra field.
    await seedOrganizerLoginCode(email)
    const api = await newApiContext()
    const profile = { name: 'Sneaky', acceptedTermsOfService: true, acceptedPrivacyPolicy: true }
    for (const data of [
      { email, code: TEST_LOGIN_CODE, profile, role: 'ADMIN' },
      { email, code: TEST_LOGIN_CODE, profile: { ...profile, role: 'ADMIN' } },
    ]) {
      const res = await api.post('auth/organizers/session', { data })
      expect(res.status()).toBe(400)
    }
    const session = await api.get('auth/session')
    expect(await session.json()).toBeNull()
  })

  test('the retired password-based organizer signup route is gone', async () => {
    const api = await newApiContext()
    const res = await api.post('auth/organizers', {
      data: { name: 'Legacy', email: uniqueEmail('legacy'), password: 'e2e-strong-password' },
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('CSRF and CORS', () => {
  test('mutating requests without an Origin are refused', async () => {
    const bare = await request.newContext({ baseURL: `${API_URL}/` })
    const res = await bare.post('auth/users', { data: signUpPayload() })
    expect(res.status()).toBe(403)
  })

  test('mutating requests from a foreign Origin are refused', async () => {
    const foreign = await request.newContext({ baseURL: `${API_URL}/`, extraHTTPHeaders: { Origin: EVIL_ORIGIN } })
    const res = await foreign.post('auth/users', { data: signUpPayload() })
    expect(res.status()).toBe(403)
  })

  test('CORS grants credentials to the app origin only', async () => {
    const api = await request.newContext()
    const allowed = await api.fetch(`${API_URL}/muns`, {
      method: 'OPTIONS',
      headers: { Origin: WEB_URL, 'Access-Control-Request-Method': 'POST' },
    })
    expect(allowed.headers()['access-control-allow-origin']).toBe(WEB_URL)
    expect(allowed.headers()['access-control-allow-credentials']).toBe('true')

    const denied = await api.fetch(`${API_URL}/muns`, {
      method: 'OPTIONS',
      headers: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    })
    expect(denied.headers()['access-control-allow-origin']).toBeUndefined()
  })
})

test.describe('payments webhook', () => {
  test('rejects a payload with a forged signature', async () => {
    const api = await request.newContext()
    const res = await api.post(`${API_ORIGIN}/webhooks/payments`, {
      headers: { 'x-webhook-signature': 'forged', 'Content-Type': 'application/json' },
      data: JSON.stringify({ orderId: 'mock_order_x', status: 'paid' }),
    })
    expect(res.status()).toBe(400)
  })

  test('a client cannot mark its own registration paid by calling the webhook', async () => {
    const delegate = await signUpViaApi()
    const res = await delegate.api.post(`${API_ORIGIN}/webhooks/payments`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ orderId: 'mock_order_anything', status: 'paid' }),
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('role and tenant boundaries', () => {
  test('students and organizers cannot take admin decisions', async () => {
    const delegate = await signUpViaApi()
    const mun = await getMun(delegate.api, CLOSED.slug)
    const asStudent = await delegate.api.post(`admin/muns/${mun.id}/review-application`, {
      data: { decision: 'APPROVED' },
    })
    expect(asStudent.status()).toBe(403)

    const organizer = await signInViaApi(OTHER_ORGANIZER_EMAIL, DEMO_PASSWORD)
    const asOrganizer = await organizer.api.post(`admin/muns/${mun.id}/review-application`, {
      data: { decision: 'APPROVED' },
    })
    expect(asOrganizer.status()).toBe(403)
  })

  test("an organizer cannot edit another organizer's MUN", async () => {
    const organizer = await signInViaApi(OTHER_ORGANIZER_EMAIL, DEMO_PASSWORD)
    const mun = await getMun(organizer.api, CLOSED.slug) // owned by organizer@munhub.test
    const res = await organizer.api.post(`muns/${mun.id}/committees`, {
      data: { name: `Hijack ${Date.now()}`, capacity: 10 },
    })
    expect(res.status()).toBe(403)
  })

  test('a student cannot create an organizer application', async () => {
    const delegate = await signUpViaApi()
    const res = await delegate.api.post('organizer/applications', {
      data: {
        conferenceName: `Student Attempt ${Date.now()}`,
        expectedDate: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        location: 'Hyderabad',
        expectedDelegateCount: 100,
        description: 'Should be refused — students cannot become organizers.',
      },
    })
    expect(res.status()).toBe(403)
  })
})
