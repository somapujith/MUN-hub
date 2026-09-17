import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munModuleVerifications, muns, users } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Module Read Mun', slug: `module-read-${crypto.randomUUID()}`, status: 'ONBOARDING' })
    .returning()
  return mun
}

async function makeOperationsUser() {
  const [user] = await db
    .insert(users)
    .values({ name: 'Ops', email: `ops-${crypto.randomUUID()}@test.com`, role: 'OPERATIONS' })
    .returning()
  return user
}

function readModule(munId: string, headers: Record<string, string> = {}) {
  return app.request(`/api/v1/muns/${munId}/modules/BASIC_INFO`, { headers })
}

describe('GET /api/v1/muns/:munId/modules/:moduleName', () => {
  it('refuses anonymous callers without touching the database', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const res = await readModule(mun.id)
    expect(res.status).toBe(401)

    const rows = await db
      .select()
      .from(munModuleVerifications)
      .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'BASIC_INFO')))
    expect(rows).toHaveLength(0)
  })

  it("refuses an organizer who doesn't own the mun, and a delegate", async () => {
    const owner = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)
    const otherOrganizer = await makeUser('ORGANIZER')
    const student = await makeUser('STUDENT')

    expect((await readModule(mun.id, await authHeaders(otherOrganizer.id))).status).toBe(403)
    expect((await readModule(mun.id, await authHeaders(student.id))).status).toBe(403)
  })

  it('lets the owning organizer, operations and admins read it', async () => {
    const owner = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    for (const user of [owner, await makeOperationsUser(), await makeUser('ADMIN')]) {
      const res = await readModule(mun.id, await authHeaders(user.id))
      expect(res.status, user.role).toBe(200)
      expect((await res.json()).state).toBe('NOT_SUBMITTED')
    }
  })
})
