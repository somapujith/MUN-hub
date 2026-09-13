import { describe, it, expect, afterAll } from 'vitest'
import { db } from '@/lib/db/client'
import { muns, users, organizerConfirmations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { submitFinalConfirmation } from './organizer-confirmation'

async function makeUser(role: 'ORGANIZER' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Confirm Mun', slug: `confirm-mun-${crypto.randomUUID()}`, status: 'CONTENT_SUBMITTED' })
    .returning()
  return mun
}

describe('submitFinalConfirmation', () => {
  it('creates a confirmation snapshot and moves the mun to VERIFICATION', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const result = await submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })
    expect(result.status).toBe('VERIFICATION')

    const [confirmation] = await db.select().from(organizerConfirmations).where(eq(organizerConfirmations.munId, mun.id))
    expect(confirmation.confirmingUserId).toBe(organizer.id)
    expect(confirmation.versionNumber).toBe(1)
    expect(confirmation.snapshotJson).toBeTruthy()
  })

  it('rejects a mun not in CONTENT_SUBMITTED status', async () => {
    const organizer = await makeUser('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Wrong State Mun', slug: `wrong-state-${crypto.randomUUID()}`, status: 'DRAFT' })
      .returning()

    await expect(submitFinalConfirmation(mun.id, { userId: organizer.id, role: 'ORGANIZER' })).rejects.toThrow()
  })

  it('rejects a non-owning organizer', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(submitFinalConfirmation(mun.id, { userId: stranger.id, role: 'ORGANIZER' })).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
