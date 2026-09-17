import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { hashOpaqueToken } from './opaque-token'
import {
  SESSION_EXTEND_INTERVAL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MAX_LIFETIME_MS,
  createSession,
  destroySession,
  getSessionByToken,
  otherSessionsOf,
  slidingSessionExpiry,
} from './session'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const email = `session-test-${Date.now()}-${Math.random()}@test.dev`
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email, role: 'ORGANIZER', ...overrides })
    .returning()
  return user
}

async function sessionRow(token: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.token, hashOpaqueToken(token)))
  return row
}

async function setTimes(token: string, times: { createdAt?: Date; expiresAt?: Date }) {
  await db.update(sessions).set(times).where(eq(sessions.token, hashOpaqueToken(token)))
}

describe('slidingSessionExpiry', () => {
  it('is the idle timeout from now while the absolute cap is further away', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z')
    const now = new Date('2026-09-02T00:00:00Z')
    expect(slidingSessionExpiry(createdAt, now).getTime()).toBe(now.getTime() + SESSION_IDLE_TIMEOUT_MS)
  })

  it('never passes the absolute cap measured from creation', () => {
    const createdAt = new Date('2026-09-01T00:00:00Z')
    const now = new Date(createdAt.getTime() + 28 * DAY)
    expect(slidingSessionExpiry(createdAt, now).getTime()).toBe(createdAt.getTime() + SESSION_MAX_LIFETIME_MS)
  })
})

describe('createSession', () => {
  it('stores only the SHA-256 of the token, never the token itself', async () => {
    const user = await makeUser()
    const { token } = await createSession(user.id)

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const [plain] = await db.select().from(sessions).where(eq(sessions.token, token))
    expect(plain).toBeUndefined()
    expect((await sessionRow(token))?.userId).toBe(user.id)
  })

  it('starts with the idle deadline, not the absolute cap', async () => {
    const user = await makeUser()
    const before = Date.now()
    const { token, expiresAt } = await createSession(user.id)

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_IDLE_TIMEOUT_MS)
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_IDLE_TIMEOUT_MS)
    expect((await sessionRow(token))?.expiresAt.getTime()).toBe(expiresAt.getTime())
  })
})

describe('getSessionByToken', () => {
  it('returns the actor identity for a valid, unexpired token', async () => {
    const user = await makeUser({ suspended: false })
    const { token } = await createSession(user.id)

    const session = await getSessionByToken(token)
    expect(session).toEqual({ userId: user.id, role: user.role })
  })

  it('returns null for a nonexistent token', async () => {
    const session = await getSessionByToken('this-token-does-not-exist')
    expect(session).toBeNull()
  })

  it('returns null for an empty token', async () => {
    const session = await getSessionByToken('')
    expect(session).toBeNull()
  })

  it('does not accept the stored digest as a token', async () => {
    const user = await makeUser()
    const { token } = await createSession(user.id)

    expect(await getSessionByToken(hashOpaqueToken(token))).toBeNull()
  })

  it('does not accept a legacy row that stored the raw token', async () => {
    const user = await makeUser()
    const legacyToken = `legacy-${Math.random()}`
    await db.insert(sessions).values({ userId: user.id, token: legacyToken, expiresAt: new Date(Date.now() + DAY) })

    expect(await getSessionByToken(legacyToken)).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const user = await makeUser({ suspended: false })
    const { token } = await createSession(user.id)

    // Directly expire the session row rather than waiting out the idle timeout.
    await setTimes(token, { expiresAt: new Date(Date.now() - 1000) })

    const session = await getSessionByToken(token)
    expect(session).toBeNull()
  })

  it('returns null past the absolute lifetime even if the deadline says otherwise', async () => {
    const user = await makeUser()
    const { token } = await createSession(user.id)
    await setTimes(token, {
      createdAt: new Date(Date.now() - SESSION_MAX_LIFETIME_MS - HOUR),
      expiresAt: new Date(Date.now() + DAY),
    })

    expect(await getSessionByToken(token)).toBeNull()
  })

  it('returns null for a suspended user even with a valid session token', async () => {
    const user = await makeUser({ suspended: true })
    const { token } = await createSession(user.id)

    const session = await getSessionByToken(token)
    expect(session).toBeNull()
  })

  it('still returns the session for a non-suspended user with a valid token', async () => {
    const user = await makeUser({ suspended: false })
    const { token } = await createSession(user.id)

    const session = await getSessionByToken(token)
    expect(session).toEqual({ userId: user.id, role: user.role })
  })

  describe('sliding expiry', () => {
    it('pushes the deadline out to a full idle window once it is more than an hour stale', async () => {
      const user = await makeUser()
      const { token } = await createSession(user.id)
      const staleDeadline = new Date(Date.now() + SESSION_IDLE_TIMEOUT_MS - 2 * HOUR)
      await setTimes(token, { createdAt: new Date(Date.now() - 2 * HOUR), expiresAt: staleDeadline })

      const before = Date.now()
      expect(await getSessionByToken(token)).not.toBeNull()

      const extended = (await sessionRow(token))!.expiresAt.getTime()
      expect(extended).toBeGreaterThanOrEqual(before + SESSION_IDLE_TIMEOUT_MS)
    })

    it('does not write on every request (at most one extension per hour)', async () => {
      const user = await makeUser()
      const { token } = await createSession(user.id)
      const recentDeadline = new Date(Date.now() + SESSION_IDLE_TIMEOUT_MS - SESSION_EXTEND_INTERVAL_MS / 2)
      await setTimes(token, { expiresAt: recentDeadline })

      expect(await getSessionByToken(token)).not.toBeNull()

      expect((await sessionRow(token))!.expiresAt.getTime()).toBe(recentDeadline.getTime())
    })

    it('keeps a session alive that is used within the idle window', async () => {
      const user = await makeUser()
      const { token } = await createSession(user.id)
      // Idle for six days, one day left.
      await setTimes(token, { createdAt: new Date(Date.now() - 6 * DAY), expiresAt: new Date(Date.now() + DAY) })

      expect(await getSessionByToken(token)).not.toBeNull()
      expect((await sessionRow(token))!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY)
    })

    it('never extends past the absolute cap', async () => {
      const user = await makeUser()
      const { token } = await createSession(user.id)
      const createdAt = new Date(Date.now() - 29 * DAY)
      await setTimes(token, { createdAt, expiresAt: new Date(Date.now() + HOUR) })

      expect(await getSessionByToken(token)).not.toBeNull()
      expect((await sessionRow(token))!.expiresAt.getTime()).toBe(createdAt.getTime() + SESSION_MAX_LIFETIME_MS)
    })
  })
})

describe('destroySession', () => {
  it('deletes the session the raw token identifies', async () => {
    const user = await makeUser()
    const { token } = await createSession(user.id)

    await destroySession(token)

    expect(await sessionRow(token)).toBeUndefined()
    expect(await getSessionByToken(token)).toBeNull()
  })

  it('is a no-op for an empty token', async () => {
    await expect(destroySession('')).resolves.toBeUndefined()
  })
})

describe('otherSessionsOf', () => {
  it("selects the user's other sessions only", async () => {
    const user = await makeUser()
    const someoneElse = await makeUser()
    const kept = await createSession(user.id)
    const other = await createSession(user.id)
    const unrelated = await createSession(someoneElse.id)

    await db.delete(sessions).where(otherSessionsOf(user.id, kept.token))

    expect(await getSessionByToken(kept.token)).not.toBeNull()
    expect(await getSessionByToken(other.token)).toBeNull()
    expect(await getSessionByToken(unrelated.token)).not.toBeNull()
  })
})

afterAll(async () => {
  await db.$client.end()
})
