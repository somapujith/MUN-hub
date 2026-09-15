import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { getMunProgress } from './go-live-dashboard'
import { TRACKED_MODULES } from '@/lib/lifecycle/module-registry'

async function makeUser(role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Dashboard Mun', slug: `dashboard-mun-${crypto.randomUUID()}`, status: 'ONBOARDING' })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('getMunProgress', () => {
  it('lets the owning organizer read their own progress', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const progress = await getMunProgress(mun.id, sessionFor(organizer))

    expect(progress.munId).toBe(mun.id)
    expect(progress.lifecycleStatus).toBe('ONBOARDING')
    expect(progress.modules).toHaveLength(TRACKED_MODULES.length)
    expect(progress.requiredTotal).toBeGreaterThan(0)
    expect(progress.submission).toBeNull()
  })

  it('rejects a non-owning organizer with Forbidden', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(getMunProgress(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
  })

  it('rejects an unauthenticated caller with Forbidden', async () => {
    const owner = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(getMunProgress(mun.id, null)).rejects.toThrow('Forbidden')
  })

  it('allows an OPERATIONS role even though they do not own the mun', async () => {
    const owner = await makeUser('ORGANIZER')
    const ops = await makeUser('OPERATIONS')
    const mun = await makeMun(owner.id)

    const progress = await getMunProgress(mun.id, sessionFor(ops))
    expect(progress.munId).toBe(mun.id)
  })

  it('allows ADMIN and SUPER_ADMIN roles even though they do not own the mun', async () => {
    const owner = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const superAdmin = await makeUser('SUPER_ADMIN')
    const mun = await makeMun(owner.id)

    await expect(getMunProgress(mun.id, sessionFor(admin))).resolves.toBeDefined()
    await expect(getMunProgress(mun.id, sessionFor(superAdmin))).resolves.toBeDefined()
  })

  it('does not include ops-only fields such as internalNotes', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const progress = await getMunProgress(mun.id, sessionFor(organizer))
    expect(progress).not.toHaveProperty('internalNotes')
    expect(JSON.stringify(progress)).not.toContain('internalNotes')
  })
})
