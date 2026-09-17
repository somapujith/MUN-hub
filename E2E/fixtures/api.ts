import { request, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test'
import postgres from 'postgres'
import { hashPassword } from '../../lib/auth/password'
import { API_ORIGIN, DATABASE_URL, WEB_URL, assertLocalDatabase } from '../env'
import { DEMO_PASSWORD } from './accounts'
import { signUpPayload, uniqueEmail, type SignUpPayload } from './data'

/**
 * Direct API access for arranging test state quickly, without driving the
 * UI for every precondition. Every mutating call carries the web origin as
 * `Origin`, because server/middleware/csrf.ts rejects mutating requests
 * without an allow-listed one — exactly as the real SPA would send it.
 *
 * Always starts signed out, whatever project storageState is in effect.
 */
export async function newApiContext(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: { cookies: [], origins: [] },
  })
}

export interface ApiSession {
  api: APIRequestContext
  userId: string
  role: string
  email: string
  password: string
}

/** Creates a brand-new STUDENT through the real signup endpoint and returns a signed-in API context. */
export async function signUpViaApi(overrides: Partial<SignUpPayload> = {}): Promise<ApiSession> {
  const api = await newApiContext()
  const payload = signUpPayload(overrides)
  const response = await api.post('auth/users', { data: payload })
  if (response.status() !== 201) {
    throw new Error(`signUpViaApi failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { userId: string; role: string }
  return { api, userId: body.userId, role: body.role, email: payload.email, password: payload.password }
}

/**
 * Signs an existing account in through the real login endpoint. Mind the
 * login rate limit (5/min per account) — prefer the per-role storageState
 * from setup/auth.setup.ts for the seeded accounts.
 */
export async function signInViaApi(email: string, password = DEMO_PASSWORD): Promise<ApiSession> {
  const api = await newApiContext()
  const response = await api.post('auth/session', { data: { email, password } })
  if (!response.ok()) {
    throw new Error(`signInViaApi(${email}) failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { userId: string; role: string }
  return { api, userId: body.userId, role: body.role, email, password }
}

/** The code `seedOrganizerLoginCode` plants by default. */
export const TEST_LOGIN_CODE = '123456'

/**
 * Organizers sign in with an emailed 6-digit code (lib/actions/organizer-otp.ts),
 * and the local API only prints that email to its console. Tests therefore
 * plant a code they know: a fresh, unconsumed, scrypt-hashed row in
 * email_login_codes, which is exactly what requesting a code creates. When a
 * UI test clicks "Send OTP" first, call this AFTER that click, because
 * requesting a code consumes every older one.
 */
export async function seedOrganizerLoginCode(email: string, code = TEST_LOGIN_CODE): Promise<void> {
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const normalized = email.trim().toLowerCase()
    await sql`update email_login_codes set consumed_at = now() where email = ${normalized} and consumed_at is null`
    // Backdated past the resend cooldown and the hourly cap, so a planted code
    // never stops a test from requesting a real one afterwards.
    await sql`
      insert into email_login_codes (id, email, code_hash, expires_at, created_at)
      values (${crypto.randomUUID()}, ${normalized}, ${await hashPassword(code)},
              now() + interval '10 minutes', now() - interval '61 minutes')`
  } finally {
    await sql.end()
  }
}

/**
 * Marks an organizer's onboarding wizard (lib/actions/organizer-onboarding.ts)
 * as finished, the way server/integration/helpers.ts does. Organizers can't
 * apply to host until this is done. Safe to call twice.
 */
export async function completeOrganizerOnboarding(userId: string): Promise<void> {
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    await sql`
      insert into organizer_profiles (user_id, first_name, last_name, contact_phone,
        upi_id, upi_phone, agreement_version, completed_at)
      values (${userId}, 'E2E', 'Organizer', '9876543210', 'e2e@ybl', '9876543210', 'e2e', now())
      on conflict (user_id) do nothing`
  } finally {
    await sql.end()
  }
}

/**
 * Creates a brand-new ORGANIZER through the real passwordless signup endpoint.
 * By default its onboarding is marked complete so it can apply to host; pass
 * `{ onboarded: false }` for tests that walk the onboarding wizard themselves.
 */
export async function signUpOrganizerViaApi(
  name = 'E2E Organizer',
  email = uniqueEmail('organizer'),
  { onboarded = true }: { onboarded?: boolean } = {},
): Promise<ApiSession> {
  await seedOrganizerLoginCode(email)
  const api = await newApiContext()
  const response = await api.post('auth/organizers/session', {
    data: {
      email,
      code: TEST_LOGIN_CODE,
      profile: { name, acceptedTermsOfService: true, acceptedPrivacyPolicy: true },
    },
  })
  if (response.status() !== 201) {
    throw new Error(`signUpOrganizerViaApi failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { userId: string; role: string }
  if (onboarded) await completeOrganizerOnboarding(body.userId)
  return { api, userId: body.userId, role: body.role, email, password: '' }
}

/** Signs an existing organizer in with a planted code (organizers have no password). */
export async function signInOrganizerViaApi(email: string): Promise<ApiSession> {
  await seedOrganizerLoginCode(email)
  const api = await newApiContext()
  const response = await api.post('auth/organizers/session', { data: { email, code: TEST_LOGIN_CODE } })
  if (response.status() !== 200) {
    throw new Error(`signInOrganizerViaApi(${email}) failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { userId: string; role: string }
  return { api, userId: body.userId, role: body.role, email, password: '' }
}

/** Opens a browser context that is already signed in as the given API session. */
export async function browserContextFor(browser: Browser, session: ApiSession): Promise<BrowserContext> {
  const storageState = await session.api.storageState()
  return browser.newContext({ storageState })
}

export interface MunDetail {
  id: string
  slug: string
  name: string
  status: string
  committees: Array<{ id: string; name: string; capacity: number | null; portfolios: Array<{ id: string; name: string }> }>
  registrationProducts: Array<{ id: string; name: string; price: number; capacity: number | null }>
  formFields: Array<{ fieldKey: string; required: boolean }>
}

export async function getMun(api: APIRequestContext, slug: string): Promise<MunDetail> {
  const response = await api.get(`muns/${slug}`)
  if (!response.ok()) throw new Error(`GET muns/${slug} failed: ${response.status()}`)
  return (await response.json()) as MunDetail
}
