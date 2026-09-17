import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailLoginCodes, passwordResetTokens, sessions, users } from '@/lib/db/schema'
import { purgeExpiredAuthArtifacts } from './purge-auth-artifacts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Other test files share this database, so the purge always runs at the real
// current time (a future `now` would delete their live rows) and assertions
// look only at this file's own rows.
describe('purgeExpiredAuthArtifacts', () => {
  it('deletes expired sessions, old used/expired reset tokens and old sign-in codes, keeping the rest', async () => {
    const now = new Date()
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs)
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    const [user] = await db
      .insert(users)
      .values({ name: 'Purge Test', email: `purge-${tag}@test.com`, role: 'STUDENT' })
      .returning()

    const sessionRows = await db
      .insert(sessions)
      .values([
        { userId: user.id, token: `purge-expired-${tag}`, expiresAt: at(-60_000) },
        { userId: user.id, token: `purge-live-${tag}`, expiresAt: at(HOUR_MS) },
      ])
      .returning()

    const resetRows = await db
      .insert(passwordResetTokens)
      .values([
        // used 8 days ago → purged
        { userId: user.id, token: `purge-used-old-${tag}`, expiresAt: at(-8 * DAY_MS + HOUR_MS), usedAt: at(-8 * DAY_MS) },
        // never used, expired 8 days ago → purged
        { userId: user.id, token: `purge-expired-old-${tag}`, expiresAt: at(-8 * DAY_MS) },
        // used yesterday → kept for now
        { userId: user.id, token: `purge-used-recent-${tag}`, expiresAt: at(-DAY_MS + HOUR_MS), usedAt: at(-DAY_MS) },
        // expired 2 days ago → kept for now
        { userId: user.id, token: `purge-expired-recent-${tag}`, expiresAt: at(-2 * DAY_MS) },
        // still valid → kept
        { userId: user.id, token: `purge-valid-${tag}`, expiresAt: at(HOUR_MS) },
      ])
      .returning()

    const codeEmail = `purge-code-${tag}@test.com`
    const codeRows = await db
      .insert(emailLoginCodes)
      .values([
        // expired 2 days ago → purged
        { email: codeEmail, codeHash: 'x', expiresAt: at(-2 * DAY_MS) },
        // consumed and expired 2 days ago → purged
        { email: codeEmail, codeHash: 'x', expiresAt: at(-2 * DAY_MS), consumedAt: at(-2 * DAY_MS - 60_000) },
        // expired an hour ago → kept for now
        { email: codeEmail, codeHash: 'x', expiresAt: at(-HOUR_MS) },
        // still valid → kept
        { email: codeEmail, codeHash: 'x', expiresAt: at(10 * 60_000) },
      ])
      .returning()

    const result = await purgeExpiredAuthArtifacts(now)

    const remainingSessions = await db
      .select({ token: sessions.token })
      .from(sessions)
      .where(
        inArray(
          sessions.id,
          sessionRows.map((row) => row.id),
        ),
      )
    expect(remainingSessions.map((row) => row.token)).toEqual([`purge-live-${tag}`])

    const remainingResets = await db
      .select({ token: passwordResetTokens.token })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id))
    expect(remainingResets.map((row) => row.token).sort()).toEqual(
      [`purge-expired-recent-${tag}`, `purge-used-recent-${tag}`, `purge-valid-${tag}`].sort(),
    )
    expect(resetRows).toHaveLength(5)

    const remainingCodes = await db
      .select({ expiresAt: emailLoginCodes.expiresAt })
      .from(emailLoginCodes)
      .where(eq(emailLoginCodes.email, codeEmail))
    expect(remainingCodes).toHaveLength(2)
    expect(remainingCodes.every((row) => row.expiresAt.getTime() > now.getTime() - DAY_MS)).toBe(true)
    expect(codeRows).toHaveLength(4)

    // Counts cover the whole table, so other files' rows can add to them.
    expect(result.sessions).toBeGreaterThanOrEqual(1)
    expect(result.passwordResetTokens).toBeGreaterThanOrEqual(2)
    expect(result.loginCodes).toBeGreaterThanOrEqual(2)
  })

  it('is idempotent: a second run finds nothing of its own to delete', async () => {
    const now = new Date()
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const [user] = await db
      .insert(users)
      .values({ name: 'Purge Twice', email: `purge-twice-${tag}@test.com`, role: 'STUDENT' })
      .returning()
    await db.insert(sessions).values({ userId: user.id, token: `purge-twice-${tag}`, expiresAt: new Date(now.getTime() - 1000) })

    await purgeExpiredAuthArtifacts(now)
    const second = await purgeExpiredAuthArtifacts(now)

    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([])
    expect(second).toEqual({
      sessions: expect.any(Number),
      passwordResetTokens: expect.any(Number),
      loginCodes: expect.any(Number),
    })
  })
})

afterAll(async () => {
  await db.$client.end()
})
