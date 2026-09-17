import { afterEach, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, users } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders } from './helpers'

const app = createApp()

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

async function makeUser(role: AnyRole, extra: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `api staff ${role}`, email: `api-staff-${crypto.randomUUID()}@test.dev`, role, ...extra })
    .returning()
  return user
}

async function call(userId: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = userId ? await authHeaders(userId) : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/v1/admin/staff', () => {
  it('lists staff for OPERATIONS and refuses organizers and anonymous callers', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')

    const ok = await call(ops.id, 'GET', `/admin/staff?q=${encodeURIComponent(ops.email)}`)
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.results.map((row: { id: string }) => row.id)).toEqual([ops.id])
    expect(body.results[0]).not.toHaveProperty('passwordHash')

    expect((await call(organizer.id, 'GET', '/admin/staff')).status).toBe(403)
    expect((await call(null, 'GET', '/admin/staff')).status).toBe(401)
  })

  it('rejects an unknown role filter with 400', async () => {
    const admin = await makeUser('ADMIN')
    const res = await call(admin.id, 'GET', '/admin/staff?role=ORGANIZER')
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/admin/staff', () => {
  it('SUPER_ADMIN creates a staff account and receives a set-password link built from APP_URL', async () => {
    vi.stubEnv('APP_URL', 'https://munhub.example')
    const superAdmin = await makeUser('SUPER_ADMIN')
    const email = `created-${crypto.randomUUID()}@test.dev`

    const res = await call(superAdmin.id, 'POST', '/admin/staff', { name: 'Ops Person', email, role: 'OPERATIONS' })

    expect(res.status).toBe(201)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.staff).toMatchObject({ email, role: 'OPERATIONS', passwordSet: false })
    expect(body.setPasswordUrl).toMatch(/^https:\/\/munhub\.example\/reset-password\?token=[0-9a-f]{64}$/)
    expect(typeof body.expiresAt).toBe('string')
  })

  it.each(['ADMIN', 'OPERATIONS'] as const)('refuses %s with 403 and creates nothing', async (role) => {
    const actor = await makeUser(role)
    const email = `refused-${crypto.randomUUID()}@test.dev`

    const res = await call(actor.id, 'POST', '/admin/staff', { name: 'X', email, role: 'SUPER_ADMIN' })

    expect(res.status).toBe(403)
    expect(await db.select().from(users).where(eq(users.email, email))).toEqual([])
  })

  it('maps a duplicate email to 409 and a non-staff role to 400', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const existing = await makeUser('STUDENT')

    const duplicate = await call(superAdmin.id, 'POST', '/admin/staff', { name: 'X', email: existing.email, role: 'ADMIN' })
    expect(duplicate.status).toBe(409)

    const badRole = await call(superAdmin.id, 'POST', '/admin/staff', {
      name: 'X',
      email: `bad-role-${crypto.randomUUID()}@test.dev`,
      role: 'STUDENT',
    })
    expect(badRole.status).toBe(400)
    expect((await badRole.json()).error.code).toBe('VALIDATION_FAILED')
  })
})

describe('staff writes', () => {
  it('SUPER_ADMIN changes a role, suspends, reinstates and reissues a link', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const target = await makeUser('OPERATIONS')

    const role = await call(superAdmin.id, 'PATCH', `/admin/staff/${target.id}/role`, { role: 'ADMIN' })
    expect(role.status).toBe(200)
    expect((await role.json()).role).toBe('ADMIN')

    const suspend = await call(superAdmin.id, 'POST', `/admin/staff/${target.id}/suspend`, { reason: 'offboarding' })
    expect(suspend.status).toBe(200)
    expect((await suspend.json()).suspended).toBe(true)

    const again = await call(superAdmin.id, 'POST', `/admin/staff/${target.id}/suspend`, { reason: 'twice' })
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('CONFLICT_STATE')

    const link = await call(superAdmin.id, 'POST', `/admin/staff/${target.id}/set-password-link`)
    expect(link.status).toBe(409)

    const reinstate = await call(superAdmin.id, 'POST', `/admin/staff/${target.id}/reinstate`)
    expect(reinstate.status).toBe(200)

    const relink = await call(superAdmin.id, 'POST', `/admin/staff/${target.id}/set-password-link`)
    expect(relink.status).toBe(200)
    expect((await relink.json()).setPasswordUrl).toContain('/reset-password?token=')

    const [log] = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.targetId, target.id))
      .orderBy(desc(adminActions.createdAt))
      .limit(1)
    expect((log.metadata as { event: string }).event).toBe('STAFF_SET_PASSWORD_LINK_ISSUED')
  })

  it('refuses acting on your own account (409) and on a non-staff account (404)', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const organizer = await makeUser('ORGANIZER')

    const self = await call(superAdmin.id, 'POST', `/admin/staff/${superAdmin.id}/suspend`, { reason: 'me' })
    expect(self.status).toBe(409)

    const notStaff = await call(superAdmin.id, 'PATCH', `/admin/staff/${organizer.id}/role`, { role: 'ADMIN' })
    expect(notStaff.status).toBe(404)
  })

  // The MFA reset lives in staff-mfa.ts but is a staff write like any other:
  // clearing your own MFA here would sidestep the code /auth/mfa/disable asks
  // for, and an arbitrary id would answer 204 for students or unknown users.
  it('the MFA reset refuses your own account (409), a non-staff target and an unknown id (404)', async () => {
    const superAdmin = await makeUser('SUPER_ADMIN')
    const student = await makeUser('STUDENT')
    const target = await makeUser('ADMIN')

    const self = await call(superAdmin.id, 'POST', `/admin/staff/${superAdmin.id}/mfa/reset`)
    expect(self.status).toBe(409)

    const notStaff = await call(superAdmin.id, 'POST', `/admin/staff/${student.id}/mfa/reset`)
    expect(notStaff.status).toBe(404)

    const unknown = await call(superAdmin.id, 'POST', `/admin/staff/${crypto.randomUUID()}/mfa/reset`)
    expect(unknown.status).toBe(404)

    expect(await db.select().from(adminActions).where(eq(adminActions.targetId, student.id))).toEqual([])

    const ok = await call(superAdmin.id, 'POST', `/admin/staff/${target.id}/mfa/reset`)
    expect(ok.status).toBe(204)
  })

  it.each([
    ['PATCH', 'role', { role: 'SUPER_ADMIN' }],
    ['POST', 'suspend', { reason: 'x' }],
    ['POST', 'reinstate', undefined],
    ['POST', 'set-password-link', undefined],
    ['POST', 'mfa/reset', undefined],
  ] as const)('refuses ADMIN on %s /%s with 403', async (method, action, body) => {
    const admin = await makeUser('ADMIN')
    const target = await makeUser('OPERATIONS')

    const res = await call(admin.id, method, `/admin/staff/${target.id}/${action}`, body)
    expect(res.status).toBe(403)
    const [row] = await db.select({ role: users.role, suspended: users.suspended }).from(users).where(eq(users.id, target.id))
    expect(row).toEqual({ role: 'OPERATIONS', suspended: false })
  })
})

describe('POST /api/v1/admin/organizers/:userId/suspend', () => {
  it('lets OPERATIONS suspend an organizer but not an admin', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')

    const ok = await call(ops.id, 'POST', `/admin/organizers/${organizer.id}/suspend`, { reason: 'spam' })
    expect(ok.status).toBe(204)

    const blocked = await call(ops.id, 'POST', `/admin/organizers/${admin.id}/suspend`, { reason: 'coup' })
    expect(blocked.status).toBe(404)
    const [row] = await db.select({ suspended: users.suspended }).from(users).where(eq(users.id, admin.id))
    expect(row.suspended).toBe(false)
  })
})
