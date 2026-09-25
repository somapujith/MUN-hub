import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, studentProfiles, users } from '@/lib/db/schema'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import { createApp } from '../src/app'
import { authHeaders, completeOrganizerOnboarding, makeUser } from './helpers'

const app = createApp()
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const APPLICATION_BODY = {
  conferenceName: 'Separate Accounts MUN',
  expectedDate: '2027-02-01T00:00:00.000Z',
  location: 'Hyderabad',
  expectedDelegateCount: 200,
  description: 'Testing that only organizer accounts can apply.',
}

let sendSpy: MockInstance<(notification: NotificationPayload) => Promise<void>>

beforeEach(() => {
  sendSpy = vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
})

afterEach(() => {
  sendSpy.mockRestore()
})

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  })
}

async function requestCode(email: string): Promise<string> {
  const res = await post('/auth/organizers/code', { email })
  expect(res.status).toBe(204)
  const code = sendSpy.mock.calls.at(-1)?.[0].body.match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error('no code emailed')
  return code
}

describe('organizer email-code auth routes', () => {
  it('creates a new organizer on the first correct code and sets the session cookie — no separate signup step', async () => {
    const email = `route-otp-${crypto.randomUUID()}@test.com`
    const code = await requestCode(email)

    const res = await post('/auth/organizers/session', { email, code })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'SIGNED_IN', role: 'ORGANIZER', isNewAccount: true })
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`)

    const [user] = await db.select().from(users).where(eq(users.id, body.userId))
    expect(user).toMatchObject({ role: 'ORGANIZER', passwordHash: null })
    expect(await db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id))).toHaveLength(0)
  })

  it('answers a delegate address exactly like any other, without sending a code', async () => {
    const student = await makeUser('STUDENT')
    const res = await post('/auth/organizers/code', { email: student.email })
    expect(res.status).toBe(204)
    expect(sendSpy.mock.calls.at(-1)?.[0].body).not.toMatch(/\d{6}/)
  })

  it('maps a wrong code to 401 and a resend inside the cooldown to 429', async () => {
    const organizer = await makeUser('ORGANIZER')
    const code = await requestCode(organizer.email)
    const wrong = code === '000000' ? '111111' : '000000'

    const wrongRes = await post('/auth/organizers/session', { email: organizer.email, code: wrong })
    expect(wrongRes.status).toBe(401)

    const resend = await post('/auth/organizers/code', { email: organizer.email })
    expect(resend.status).toBe(429)
  })

  it('rejects smuggled fields: a role or profile object on the session call, or a password on the code call', async () => {
    const email = `route-smuggle-${crypto.randomUUID()}@test.com`
    const withRole = await post('/auth/organizers/session', { email, code: '123456', role: 'ADMIN' })
    expect(withRole.status).toBe(400)

    const withProfile = await post('/auth/organizers/session', {
      email,
      code: '123456',
      profile: { name: 'Smuggled Name' },
    })
    expect(withProfile.status).toBe(400)

    const withPassword = await post('/auth/organizers/code', { email, password: 'hunter22' })
    expect(withPassword.status).toBe(400)
  })

  it('no longer accepts password signup for organizers', async () => {
    const res = await post('/auth/organizers', {
      name: 'Old Flow',
      email: `route-old-${crypto.randomUUID()}@test.com`,
      password: 'a-good-password',
      acceptedTermsOfService: true,
      acceptedPrivacyPolicy: true,
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/organizer/applications', () => {
  it('refuses a delegate account', async () => {
    const student = await makeUser('STUDENT')
    const res = await post('/organizer/applications', APPLICATION_BODY, await authHeaders(student.id))

    expect(res.status).toBe(403)
    const [unchanged] = await db.select({ role: users.role }).from(users).where(eq(users.id, student.id))
    expect(unchanged.role).toBe('STUDENT')
  })

  it('refuses an organizer who has not finished onboarding', async () => {
    const organizer = await makeUser('ORGANIZER')
    const res = await post('/organizer/applications', APPLICATION_BODY, await authHeaders(organizer.id))

    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toBe('Finish organizer onboarding before applying to host a MUN')
  })

  it('accepts an organizer who has finished onboarding', async () => {
    const organizer = await makeUser('ORGANIZER')
    await completeOrganizerOnboarding(organizer.id)
    const res = await post('/organizer/applications', APPLICATION_BODY, await authHeaders(organizer.id))

    expect(res.status).toBe(201)
  })
})

describe('POST /api/v1/organizer/applications/:munId/resubmit', () => {
  // docs/review-to-claude.md item #1 — the Gate-1 CHANGES_REQUESTED loop.
  async function makeChangesRequestedApplication() {
    const organizer = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Route Resubmit MUN',
        slug: `route-resubmit-${crypto.randomUUID()}`,
        description: 'Needs more detail before it can be approved.',
        startDate: new Date('2027-10-01'),
        city: 'Chennai',
        status: 'CHANGES_REQUESTED',
      })
      .returning()
    await db.insert(organizerApplications).values({
      organizerId: organizer.id,
      munId: mun.id,
      status: 'CHANGES_REQUESTED',
      reviewNotes: 'Please clarify your delegate count.',
      expectedDelegateCount: 50,
    })
    return { organizer, mun }
  }

  it('refuses a caller who does not own the application', async () => {
    const { mun } = await makeChangesRequestedApplication()
    const stranger = await makeUser('ORGANIZER')

    const res = await post(`/organizer/applications/${mun.id}/resubmit`, APPLICATION_BODY, await authHeaders(stranger.id))

    expect(res.status).toBe(403)
    const [unchanged] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, mun.id))
    expect(unchanged.status).toBe('CHANGES_REQUESTED')
  })

  it('refuses a delegate account', async () => {
    const { mun } = await makeChangesRequestedApplication()
    const student = await makeUser('STUDENT')

    const res = await post(`/organizer/applications/${mun.id}/resubmit`, APPLICATION_BODY, await authHeaders(student.id))

    expect(res.status).toBe(403)
  })

  it('puts the owning organizer back to SUBMITTED and saves the edited answers', async () => {
    const { organizer, mun } = await makeChangesRequestedApplication()

    const res = await post(
      `/organizer/applications/${mun.id}/resubmit`,
      { ...APPLICATION_BODY, conferenceName: 'Route Resubmit MUN — fixed' },
      await authHeaders(organizer.id),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('SUBMITTED')
    expect(body.reviewNotes).toBeNull()

    const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
    expect(updatedMun.status).toBe('SUBMITTED')
    expect(updatedMun.name).toBe('Route Resubmit MUN — fixed')
  })

  it('refuses a mun that is not currently CHANGES_REQUESTED', async () => {
    const { organizer, mun } = await makeChangesRequestedApplication()
    await db.update(muns).set({ status: 'ONBOARDING' }).where(eq(muns.id, mun.id))

    const res = await post(`/organizer/applications/${mun.id}/resubmit`, APPLICATION_BODY, await authHeaders(organizer.id))

    expect(res.status).toBe(409)
  })
})
