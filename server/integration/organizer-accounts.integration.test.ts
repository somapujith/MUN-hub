import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { studentProfiles, users } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const APPLICATION_BODY = {
  conferenceName: 'Separate Accounts MUN',
  expectedDate: '2027-02-01T00:00:00.000Z',
  location: 'Hyderabad',
  expectedDelegateCount: 200,
  description: 'Testing that only organizer accounts can apply.',
}

function organizerSignUpBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Route Organizer',
    email: `route-org-${crypto.randomUUID()}@test.com`,
    password: 'a-good-password',
    acceptedTermsOfService: true,
    acceptedPrivacyPolicy: true,
    ...overrides,
  }
}

describe('POST /api/v1/auth/organizers', () => {
  it('creates an ORGANIZER account with no student profile and sets the session cookie', async () => {
    const body = organizerSignUpBody()
    const res = await app.request('/api/v1/auth/organizers', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.role).toBe('ORGANIZER')
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`)

    const [user] = await db.select().from(users).where(eq(users.id, created.userId))
    expect(user.role).toBe('ORGANIZER')
    const profiles = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, created.userId))
    expect(profiles).toHaveLength(0)
  })

  it('rejects a body that tries to pick its own role', async () => {
    const res = await app.request('/api/v1/auth/organizers', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(organizerSignUpBody({ role: 'ADMIN' })),
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

describe('POST /api/v1/organizer/applications', () => {
  it('refuses a delegate account', async () => {
    const student = await makeUser('STUDENT')
    const res = await app.request('/api/v1/organizer/applications', {
      method: 'POST',
      headers: { ...(await authHeaders(student.id)), ...JSON_HEADERS },
      body: JSON.stringify(APPLICATION_BODY),
    })

    expect(res.status).toBe(403)
    const [unchanged] = await db.select({ role: users.role }).from(users).where(eq(users.id, student.id))
    expect(unchanged.role).toBe('STUDENT')
  })

  it('accepts an organizer account', async () => {
    const organizer = await makeUser('ORGANIZER')
    const res = await app.request('/api/v1/organizer/applications', {
      method: 'POST',
      headers: { ...(await authHeaders(organizer.id)), ...JSON_HEADERS },
      body: JSON.stringify(APPLICATION_BODY),
    })

    expect(res.status).toBe(201)
  })
})
