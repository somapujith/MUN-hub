import { afterAll, describe, expect, it } from 'vitest'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, passwordResetTokens, sessions, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { createSession, getSessionByToken } from '@/lib/auth/session'
import { resetPassword } from './password-reset'
import {
  bootstrapSuperAdmin,
  changeStaffRole,
  createStaffAccount,
  issueStaffSetPasswordLink,
  listStaff,
  reinstateStaff,
  STAFF_ERRORS,
  STAFF_SET_PASSWORD_TTL_MS,
  suspendStaff,
} from './admin-staff'

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

const APP_URL = 'https://admin.example.test/'

async function makeUser(role: AnyRole, extra: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `staff-test ${role}`, email: `staff-${crypto.randomUUID()}@test.dev`, role, ...extra })
    .returning()
  return user
}

function sess(user: { id: string; role: AnyRole }): Session {
  return { userId: user.id, role: user.role }
}

function tokenFrom(url: string): string {
  const token = new URL(url).searchParams.get('token')
  if (!token) throw new Error('no token in link')
  return token
}

async function latestAudit(targetId: string) {
  const [row] = await db
    .select()
    .from(adminActions)
    .where(eq(adminActions.targetId, targetId))
    .orderBy(desc(adminActions.createdAt))
    .limit(1)
  return row
}

describe('listStaff', () => {
  it('returns staff accounts only, never passwordHash, and is readable by OPERATIONS', async () => {
    const ops = await makeUser('OPERATIONS')
    const marker = `Staffdir-${crypto.randomUUID()}`
    const admin = await makeUser('ADMIN', { name: `${marker} admin`, passwordHash: 'salt:hash' })
    const organizer = await makeUser('ORGANIZER', { name: `${marker} organizer` })

    const { results, total } = await listStaff({ q: marker }, sess(ops))

    expect(results.map((row) => row.id)).toEqual([admin.id])
    expect(total).toBe(1)
    expect(results[0]).toMatchObject({ role: 'ADMIN', passwordSet: true, suspended: false })
    expect(results[0]).not.toHaveProperty('passwordHash')
    expect(results.some((row) => row.id === organizer.id)).toBe(false)
  })

  it('filters by role and matches email case-insensitively', async () => {
    const admin = await makeUser('ADMIN')
    const target = await makeUser('OPERATIONS')

    const byEmail = await listStaff({ q: target.email.toUpperCase(), role: 'OPERATIONS' }, sess(admin))
    expect(byEmail.results.map((row) => row.id)).toEqual([target.id])

    const wrongRole = await listStaff({ q: target.email, role: 'ADMIN' }, sess(admin))
    expect(wrongRole.results).toEqual([])
  })

  it.each(['STUDENT', 'ORGANIZER'] as const)('refuses a %s session', async (role) => {
    const user = await makeUser(role)
    await expect(listStaff({}, sess(user))).rejects.toThrow('Forbidden')
  })

  it('refuses no session', async () => {
    await expect(listStaff({}, null)).rejects.toThrow('Forbidden')
  })
})

describe('createStaffAccount', () => {
  it('creates a passwordless staff account, audits it, and returns a working one-time link', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const email = `New.Staff-${crypto.randomUUID()}@Test.dev`

    const before = Date.now()
    const result = await createStaffAccount({ name: '  New Staff ', email, role: 'OPERATIONS' }, APP_URL, sess(superAdmin))

    expect(result.staff).toMatchObject({
      name: 'New Staff',
      email: email.toLowerCase(),
      role: 'OPERATIONS',
      suspended: false,
      passwordSet: false,
    })
    expect(result.setPasswordUrl.startsWith('https://admin.example.test/reset-password?token=')).toBe(true)
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + STAFF_SET_PASSWORD_TTL_MS - 1000)

    const log = await latestAudit(result.staff.id)
    expect(log).toMatchObject({ actorId: superAdmin.id, action: 'ORGANIZER_REINSTATED', targetType: 'user' })
    expect(log.metadata).toEqual({ event: 'STAFF_CREATED', role: 'OPERATIONS' })
    expect(JSON.stringify(log.metadata)).not.toContain(tokenFrom(result.setPasswordUrl))

    // The link is consumed by the ordinary reset-password flow.
    await resetPassword(tokenFrom(result.setPasswordUrl), 'a-strong-password')
    const [after] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, result.staff.id))
    expect(after.passwordHash).not.toBeNull()
    await expect(resetPassword(tokenFrom(result.setPasswordUrl), 'another-password')).rejects.toThrow(
      'This reset link is invalid or has expired',
    )
  })

  it('refuses an email that already has any account', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const student = await makeUser('STUDENT')

    await expect(
      createStaffAccount({ name: 'Dup', email: student.email.toUpperCase(), role: 'ADMIN' }, APP_URL, sess(superAdmin)),
    ).rejects.toThrow('An account with that email already exists')

    const [unchanged] = await db.select({ role: users.role }).from(users).where(eq(users.id, student.id))
    expect(unchanged.role).toBe('STUDENT')
  })

  it('validates name, email and role', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const email = `valid-${crypto.randomUUID()}@test.dev`

    await expect(createStaffAccount({ name: ' ', email, role: 'ADMIN' }, APP_URL, sess(superAdmin))).rejects.toThrow(
      STAFF_ERRORS.nameRequired,
    )
    await expect(
      createStaffAccount({ name: 'X', email: 'not-an-email', role: 'ADMIN' }, APP_URL, sess(superAdmin)),
    ).rejects.toThrow(STAFF_ERRORS.invalidEmail)
    await expect(
      createStaffAccount({ name: 'X', email, role: 'ORGANIZER' as never }, APP_URL, sess(superAdmin)),
    ).rejects.toThrow(STAFF_ERRORS.invalidRole)
  })

  it.each(['OPERATIONS', 'ADMIN', 'ORGANIZER'] as const)('refuses a %s session', async (role) => {
    const actor = await makeUser(role)
    const email = `denied-${crypto.randomUUID()}@test.dev`

    await expect(createStaffAccount({ name: 'X', email, role: 'ADMIN' }, APP_URL, sess(actor))).rejects.toThrow(
      'Forbidden',
    )
    const rows = await db.select().from(users).where(eq(users.email, email))
    expect(rows).toEqual([])
  })

  it('refuses a stale SUPER_ADMIN session whose account was demoted', async () => {
    const demoted = await makeUser('ADMIN')
    const email = `stale-${crypto.randomUUID()}@test.dev`

    // The session still claims SUPER_ADMIN, but the row lock re-reads the table.
    await expect(
      createStaffAccount({ name: 'X', email, role: 'ADMIN' }, APP_URL, { userId: demoted.id, role: 'SUPER_ADMIN' }),
    ).rejects.toThrow('Forbidden')
  })
})

describe('changeStaffRole', () => {
  it('changes the role and records from/to in the audit metadata', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const target = await makeUser('OPERATIONS')

    const updated = await changeStaffRole(target.id, 'ADMIN', sess(superAdmin))
    expect(updated.role).toBe('ADMIN')

    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, target.id))
    expect(row.role).toBe('ADMIN')
    const log = await latestAudit(target.id)
    expect(log.metadata).toEqual({ event: 'STAFF_ROLE_CHANGED', fromRole: 'OPERATIONS', toRole: 'ADMIN' })
  })

  it('a no-op change writes no audit row', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const target = await makeUser('ADMIN')

    await changeStaffRole(target.id, 'ADMIN', sess(superAdmin))
    expect(await latestAudit(target.id)).toBeUndefined()
  })

  it('refuses your own account', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    await expect(changeStaffRole(superAdmin.id, 'ADMIN', sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.self)
  })

  it('refuses a non-staff target as not found', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const organizer = await makeUser('ORGANIZER')

    await expect(changeStaffRole(organizer.id, 'ADMIN', sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.notFound)
    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, organizer.id))
    expect(row.role).toBe('ORGANIZER')
  })

  it('refuses ADMIN and OPERATIONS actors', async () => {
    const admin = await makeUser('ADMIN')
    const ops = await makeUser('OPERATIONS')
    const target = await makeUser('OPERATIONS')

    await expect(changeStaffRole(target.id, 'SUPER_ADMIN', sess(admin))).rejects.toThrow('Forbidden')
    await expect(changeStaffRole(target.id, 'SUPER_ADMIN', sess(ops))).rejects.toThrow('Forbidden')
  })

  it('two super admins demoting each other at once leave one super admin in place', async () => {
    const a = await makeUser('SUPER_ADMIN')
    const b = await makeUser('SUPER_ADMIN')

    const outcomes = await Promise.allSettled([
      changeStaffRole(b.id, 'ADMIN', sess(a)),
      changeStaffRole(a.id, 'ADMIN', sess(b)),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.message).toBe('Forbidden')

    const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, a.id))
    const rowsB = await db.select({ role: users.role }).from(users).where(eq(users.id, b.id))
    expect([rows[0].role, rowsB[0].role].sort()).toEqual(['ADMIN', 'SUPER_ADMIN'])
  })
})

describe('suspendStaff / reinstateStaff', () => {
  it('suspends, kills existing sessions, and audits with the reason', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const target = await makeUser('ADMIN')
    const { token } = await createSession(target.id)
    expect(await getSessionByToken(token)).not.toBeNull()

    const updated = await suspendStaff(target.id, '  left the team ', sess(superAdmin))
    expect(updated).toMatchObject({ suspended: true, suspendedReason: 'left the team' })

    expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toEqual([])
    expect(await getSessionByToken(token)).toBeNull()

    const log = await latestAudit(target.id)
    expect(log).toMatchObject({ action: 'USER_SUSPENDED', reason: 'left the team', actorId: superAdmin.id })
    expect(log.metadata).toEqual({ event: 'STAFF_SUSPENDED', role: 'ADMIN' })
  })

  it('reinstates a suspended staff account', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const target = await makeUser('OPERATIONS', { suspended: true, suspendedReason: 'x', suspendedAt: new Date() })

    const updated = await reinstateStaff(target.id, sess(superAdmin))
    expect(updated).toMatchObject({ suspended: false, suspendedReason: null, suspendedAt: null })

    const log = await latestAudit(target.id)
    expect(log.action).toBe('ORGANIZER_REINSTATED')
    expect(log.metadata).toEqual({ event: 'STAFF_REINSTATED', role: 'OPERATIONS' })
  })

  it('rejects double-suspend, reinstating an active account, blank reasons and self', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const active = await makeUser('ADMIN')
    const suspended = await makeUser('ADMIN', { suspended: true, suspendedReason: 'x', suspendedAt: new Date() })

    await expect(suspendStaff(suspended.id, 'again', sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.alreadySuspended)
    await expect(reinstateStaff(active.id, sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.notSuspended)
    await expect(suspendStaff(active.id, '   ', sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.reasonRequired)
    await expect(suspendStaff(superAdmin.id, 'me', sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.self)
  })

  it('refuses to suspend a delegate or organizer account', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const student = await makeUser('STUDENT')
    await expect(suspendStaff(student.id, 'x', sess(superAdmin))).rejects.toThrow(STAFF_ERRORS.notFound)
  })

  it('refuses ADMIN and OPERATIONS actors', async () => {
    const admin = await makeUser('ADMIN')
    const ops = await makeUser('OPERATIONS')
    const target = await makeUser('ADMIN')

    await expect(suspendStaff(target.id, 'x', sess(admin))).rejects.toThrow('Forbidden')
    await expect(suspendStaff(target.id, 'x', sess(ops))).rejects.toThrow('Forbidden')
    await expect(reinstateStaff(target.id, sess(ops))).rejects.toThrow('Forbidden')
  })
})

describe('issueStaffSetPasswordLink', () => {
  it('issues a new link and retires the older unused one', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const created = await createStaffAccount(
      { name: 'Relink', email: `relink-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' },
      APP_URL,
      sess(superAdmin),
    )

    const fresh = await issueStaffSetPasswordLink(created.staff.id, APP_URL, sess(superAdmin))
    expect(fresh.setPasswordUrl).not.toBe(created.setPasswordUrl)

    const open = await db
      .select({ token: passwordResetTokens.token })
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, created.staff.id), isNull(passwordResetTokens.usedAt)))
    expect(open.map((row) => row.token)).toEqual([tokenFrom(fresh.setPasswordUrl)])

    await expect(resetPassword(tokenFrom(created.setPasswordUrl), 'a-strong-password')).rejects.toThrow()
    await resetPassword(tokenFrom(fresh.setPasswordUrl), 'a-strong-password')

    const log = await latestAudit(created.staff.id)
    expect((log.metadata as { event: string }).event).toBe('STAFF_SET_PASSWORD_LINK_ISSUED')
  })

  it('refuses a suspended account, your own account, non-staff and non-super-admins', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const admin = await makeUser('ADMIN')
    const suspended = await makeUser('ADMIN', { suspended: true, suspendedReason: 'x', suspendedAt: new Date() })
    const student = await makeUser('STUDENT')

    await expect(issueStaffSetPasswordLink(suspended.id, APP_URL, sess(superAdmin))).rejects.toThrow(
      STAFF_ERRORS.suspendedNoLink,
    )
    await expect(issueStaffSetPasswordLink(superAdmin.id, APP_URL, sess(superAdmin))).rejects.toThrow(
      STAFF_ERRORS.self,
    )
    await expect(issueStaffSetPasswordLink(student.id, APP_URL, sess(superAdmin))).rejects.toThrow(
      STAFF_ERRORS.notFound,
    )
    await expect(issueStaffSetPasswordLink(suspended.id, APP_URL, sess(admin))).rejects.toThrow('Forbidden')

    const tokens = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, student.id))
    expect(tokens).toEqual([])
  })
})

describe('bootstrapSuperAdmin', () => {
  it('creates a new SUPER_ADMIN with a working link', async () => {
    const email = `boot-${crypto.randomUUID()}@test.dev`

    const result = await bootstrapSuperAdmin({ email }, 'http://localhost:5173')

    expect(result).toMatchObject({ created: true, previousRole: null, wasSuspended: false })
    const [row] = await db.select().from(users).where(eq(users.id, result.userId))
    expect(row).toMatchObject({ email, role: 'SUPER_ADMIN', name: email.split('@')[0] })

    const log = await latestAudit(result.userId)
    expect(log.actorId).toBe(result.userId)
    expect(log.metadata).toMatchObject({ event: 'SUPER_ADMIN_BOOTSTRAPPED', created: true })

    await resetPassword(tokenFrom(result.setPasswordUrl), 'a-strong-password')
  })

  it('promotes and reinstates an existing account', async () => {
    const existing = await makeUser('ADMIN', { suspended: true, suspendedReason: 'x', suspendedAt: new Date() })

    const result = await bootstrapSuperAdmin({ email: existing.email.toUpperCase() }, 'http://localhost:5173')

    expect(result).toMatchObject({ userId: existing.id, created: false, previousRole: 'ADMIN', wasSuspended: true })
    const [row] = await db.select().from(users).where(eq(users.id, existing.id))
    expect(row).toMatchObject({ role: 'SUPER_ADMIN', suspended: false, suspendedReason: null })
  })
})

afterAll(async () => {
  await db.$client.end()
})
