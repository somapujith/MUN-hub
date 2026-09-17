import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

async function makeApplication() {
  const organizer = await makeUser()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Gate 1 API Mun', slug: `gate1-api-${crypto.randomUUID()}`, status: 'SUBMITTED' })
    .returning()
  await db.insert(organizerApplications).values({ organizerId: organizer.id, munId: mun.id, status: 'SUBMITTED' })
  return mun
}

async function decide(munId: string, body: Record<string, unknown>) {
  const admin = await makeUser('ADMIN')
  return app.request(`/api/v1/admin/muns/${munId}/review-application`, {
    method: 'POST',
    headers: { ...(await authHeaders(admin.id)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function statuses(munId: string) {
  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId))
  const [application] = await db
    .select({ status: organizerApplications.status })
    .from(organizerApplications)
    .where(eq(organizerApplications.munId, munId))
  return { mun: mun.status, application: application.status }
}

describe('POST /api/v1/admin/muns/:munId/review-application', () => {
  it.each([
    { decision: 'REJECTED' },
    { decision: 'REJECTED', notes: '   ' },
    { decision: 'CHANGES_REQUESTED' },
    { decision: 'CHANGES_REQUESTED', notes: '' },
  ])('refuses %o with 400 VALIDATION_FAILED on notes', async (body) => {
    const mun = await makeApplication()
    const res = await decide(mun.id, body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_FAILED')
    expect(json.error.fields?.notes).toEqual(['A reason is required to reject or request changes'])
    expect(await statuses(mun.id)).toEqual({ mun: 'SUBMITTED', application: 'SUBMITTED' })
  })

  it('approval without notes lands the MUN in ONBOARDING and marks the application APPROVED', async () => {
    const mun = await makeApplication()
    const res = await decide(mun.id, { decision: 'APPROVED' })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ONBOARDING')
    expect(await statuses(mun.id)).toEqual({ mun: 'ONBOARDING', application: 'APPROVED' })
  })

  it('a rejection with a reason is recorded on both the MUN and the application', async () => {
    const mun = await makeApplication()
    const res = await decide(mun.id, { decision: 'REJECTED', notes: 'Could not verify the organizing body' })
    expect(res.status).toBe(200)
    expect(await statuses(mun.id)).toEqual({ mun: 'REJECTED', application: 'REJECTED' })
  })
})
