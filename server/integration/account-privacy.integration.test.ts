import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { registrations, sessions, users } from '@/lib/db/schema'
import { ACCOUNT_DELETION_ERRORS, deletedUserEmail } from '@/lib/actions/account-deletion'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'
import {
  DELEGATE_PASSWORD,
  makeAccount,
  makeDelegateWithHistory,
} from '@/lib/actions/privacy-test-helpers'
import { createApp } from '../src/app'
import { authHeaders } from './helpers'

const app = createApp()

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// Loose shape for asserting on JSON bodies (export payloads and error bodies).
type ApiBody = Record<string, any>

function deleteRequest(headers: Record<string, string>, body: unknown) {
  return app.request('/api/v1/account/delete', {
    method: 'POST',
    headers: { ...headers, ...JSON_HEADERS },
    body: JSON.stringify(body),
  })
}

describe('GET /api/v1/account/export', () => {
  it('returns the signed-in user\'s data as a downloadable, uncached JSON file', async () => {
    const fixture = await makeDelegateWithHistory()
    const headers = { Cookie: `${SESSION_COOKIE_NAME}=${fixture.sessionToken}` }

    const res = await app.request('/api/v1/account/export', { headers })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="munhub-data-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = (await res.json()) as ApiBody
    expect(body.format).toBe('munhub-account-export')
    expect(body.account).toMatchObject({ id: fixture.delegate.id, email: fixture.delegate.email })
    expect(Object.keys(body).sort()).toEqual(
      [
        'account',
        'achievements',
        'consents',
        'exportedAt',
        'format',
        'organizerApplications',
        'organizerProfile',
        'payments',
        'registrations',
        'studentProfile',
        'supportTickets',
        'version',
      ].sort(),
    )
    expect(body.registrations).toHaveLength(4)
    expect(body.payments).toHaveLength(2)
    expect(body.supportTickets[0].messages).toHaveLength(2)
    expect(typeof body.exportedAt).toBe('string')
  })

  it('requires a session', async () => {
    const res = await app.request('/api/v1/account/export')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/account/delete', () => {
  it('requires a session', async () => {
    const res = await deleteRequest({}, { confirmation: 'DELETE', password: DELEGATE_PASSWORD })
    expect(res.status).toBe(401)
  })

  it('refuses an organizer with 403 and guidance to contact support', async () => {
    const organizer = await makeAccount('ORGANIZER')
    const headers = await authHeaders(organizer.id)

    const res = await deleteRequest(headers, { confirmation: 'DELETE', password: DELEGATE_PASSWORD })

    expect(res.status).toBe(403)
    const body = (await res.json()) as ApiBody
    expect(body.error).toEqual({ code: 'FORBIDDEN', message: ACCOUNT_DELETION_ERRORS.notSelfService })
    expect(body.error.message).toContain('support@munhub.in')
    const [after] = await db.select().from(users).where(eq(users.id, organizer.id))
    expect(after.email).toBe(organizer.email)
  })

  it('rejects a wrong confirmation (400), a wrong password (401) and a malformed body (400)', async () => {
    const delegate = await makeAccount('STUDENT')
    const headers = await authHeaders(delegate.id)

    const wrongWord = await deleteRequest(headers, { confirmation: 'yes', password: DELEGATE_PASSWORD })
    expect(wrongWord.status).toBe(400)
    expect(((await wrongWord.json()) as ApiBody).error.message).toBe(ACCOUNT_DELETION_ERRORS.confirmation)

    const wrongPassword = await deleteRequest(headers, { confirmation: 'DELETE', password: 'not-it' })
    expect(wrongPassword.status).toBe(401)
    expect(((await wrongPassword.json()) as ApiBody).error.message).toBe(ACCOUNT_DELETION_ERRORS.password)

    const missingPassword = await deleteRequest(headers, { confirmation: 'DELETE' })
    expect(missingPassword.status).toBe(400)
    expect(((await missingPassword.json()) as ApiBody).error.code).toBe('VALIDATION_FAILED')

    const [after] = await db.select().from(users).where(eq(users.id, delegate.id))
    expect(after.email).toBe(delegate.email)
  })

  it('anonymizes the delegate, clears the session cookie and signs every session out', async () => {
    const fixture = await makeDelegateWithHistory()
    const headers = { Cookie: `${SESSION_COOKIE_NAME}=${fixture.sessionToken}` }
    const otherDeviceHeaders = await authHeaders(fixture.delegate.id)
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await deleteRequest(headers, { confirmation: 'DELETE', password: DELEGATE_PASSWORD })
    vi.restoreAllMocks()

    expect(res.status).toBe(204)
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(setCookie).toMatch(/Max-Age=0/i)

    for (const sessionHeaders of [headers, otherDeviceHeaders]) {
      const sessionRes = await app.request('/api/v1/auth/session', { headers: sessionHeaders })
      expect(await sessionRes.json()).toBeNull()
    }
    expect(await db.select().from(sessions).where(eq(sessions.userId, fixture.delegate.id))).toEqual([])

    const [after] = await db.select().from(users).where(eq(users.id, fixture.delegate.id))
    expect(after).toMatchObject({ name: 'Deleted user', email: deletedUserEmail(fixture.delegate.id), passwordHash: null })
    expect(await db.select().from(registrations).where(eq(registrations.userId, fixture.delegate.id))).toHaveLength(4)

    const signInRes = await app.request('/api/v1/auth/session', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: fixture.delegate.email, password: DELEGATE_PASSWORD }),
    })
    expect(signInRes.status).toBe(401)
  })
})

afterAll(async () => {
  await db.$client.end()
})
