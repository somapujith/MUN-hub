import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailVerificationTokens, users } from '@/lib/db/schema'
import { createApp } from '../src/app'

const app = createApp()
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function makeUser() {
  const [user] = await db
    .insert(users)
    .values({ name: 'Verify Route', email: `verify-route-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  return user
}

function extractToken(body: string): string {
  const match = body.match(/token=([a-f0-9]+)/)
  if (!match) throw new Error('no token found')
  return match[1]
}

describe('email verification REST routes', () => {
  it('POST /verify-email/resend always returns 204, even for an unknown email', async () => {
    const res = await app.request('/api/v1/verify-email/resend', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'nobody-here@test.dev' }),
    })
    expect(res.status).toBe(204)
  })

  it('resend issues a token that POST /verify-email accepts, verifying the user', async () => {
    const user = await makeUser()

    const resendRes = await app.request('/api/v1/verify-email/resend', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: user.email }),
    })
    expect(resendRes.status).toBe(204)

    const [row] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id))
    expect(row).toBeDefined()

    // No EMAIL_OUTBOX_FILE set for this test, so capture the raw token by
    // calling sendVerificationEmail directly with a mock adapter (same
    // approach lib/actions/email-verification.test.ts uses) rather than
    // trying to read it back out of the resend call above.
    const { sendVerificationEmail } = await import('@/lib/actions/email-verification')
    const sent: { to: string; subject: string; body: string }[] = []
    await sendVerificationEmail(user.id, 'http://localhost:5173', { send: async (n) => void sent.push(n) })
    const rawToken = extractToken(sent[0].body)

    const verifyRes = await app.request('/api/v1/verify-email', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: rawToken }),
    })
    expect(verifyRes.status).toBe(204)

    const [updatedUser] = await db.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, user.id))
    expect(updatedUser.emailVerifiedAt).not.toBeNull()
  })

  it('does the work after the response on Workers, so response time reveals nothing either', async () => {
    // Awaiting inline leaks what the flat 204 hides: a registered address
    // costs a token write plus a mail-provider round-trip, an unknown one a
    // single indexed lookup.
    const waitUntil = vi.fn()
    const res = await app.request(
      '/api/v1/verify-email/resend',
      { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email: 'nobody-here@test.dev' }) },
      {},
      { waitUntil, passThroughOnException: () => {}, props: {} },
    )

    expect(res.status).toBe(204)
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  it('POST /verify-email with a bogus token returns 400 VALIDATION_FAILED, not 500', async () => {
    const res = await app.request('/api/v1/verify-email', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: 'not-a-real-token' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('POST /verify-email with an empty token is rejected by validation before the action runs', async () => {
    const res = await app.request('/api/v1/verify-email', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: '' }),
    })
    expect(res.status).toBe(400)
  })
})
