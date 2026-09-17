import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import { deletedUserEmail } from '@/lib/actions/account-deletion'
import type { RegistrationStatus } from '@/lib/db/schema-enums'
import { purgeDeletedUserAnswers } from './purge-deleted-user-answers'

const DAY_MS = 24 * 60 * 60 * 1000
const ANSWERS = { emergency_contact_name: 'Parent Name', dietary: 'Vegetarian' }

function tag() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function makeUser(anonymized: boolean) {
  const suffix = tag()
  const [user] = await db
    .insert(users)
    .values({ name: 'Purge Answers', email: `purge-answers-${suffix}@test.com`, role: 'STUDENT' })
    .returning()
  if (!anonymized) return user
  const [updated] = await db
    .update(users)
    .set({ name: 'Deleted user', email: deletedUserEmail(user.id) })
    .where(eq(users.id, user.id))
    .returning()
  return updated
}

/** A mun whose last day is `endOffsetMs` from now, plus one registration product. */
async function makeMun(endOffsetMs: number) {
  const now = Date.now()
  const [organizer] = await db
    .insert(users)
    .values({ name: 'Purge Organizer', email: `purge-organizer-${tag()}@test.com`, role: 'ORGANIZER' })
    .returning()
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId: organizer.id,
      name: 'Purge Answers MUN',
      slug: `purge-answers-${tag()}`,
      startDate: new Date(now + endOffsetMs - DAY_MS),
      endDate: new Date(now + endOffsetMs),
    })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate Pass', price: 100000, capacity: 50 })
    .returning()
  return { mun, product }
}

async function register(userId: string, munId: string, productId: string, status: RegistrationStatus) {
  const [registration] = await db
    .insert(registrations)
    .values({
      userId,
      munId,
      registrationProductId: productId,
      status,
      formResponses: ANSWERS,
      accommodationAnswers: { roommate: 'Friend Name' },
    })
    .returning()
  return registration
}

async function answersOf(id: string) {
  const [row] = await db
    .select({ formResponses: registrations.formResponses, accommodationAnswers: registrations.accommodationAnswers })
    .from(registrations)
    .where(eq(registrations.id, id))
    .limit(1)
  return row
}

// Other test files share this database, so `now` is always the real current
// time and assertions look only at this file's own rows.
describe('purgeDeletedUserAnswers', () => {
  it('clears a deleted delegate\'s retained answers once the conference has ended, and leaves everything else alone', async () => {
    const now = new Date()

    const deleted = await makeUser(true)
    const live = await makeUser(false)

    const past = await makeMun(-5 * DAY_MS)
    const upcoming = await makeMun(10 * DAY_MS)

    // Kept at deletion time because the conference was still ahead; now it is over.
    const dueForPurge = await register(deleted.id, past.mun.id, past.product.id, 'CONFIRMED')
    const attendedDueForPurge = await register(deleted.id, past.mun.id, past.product.id, 'ATTENDED')
    // Still ahead — the organizer needs these on the day.
    const stillNeeded = await register(deleted.id, upcoming.mun.id, upcoming.product.id, 'CONFIRMED')
    // A live account's answers are never touched by this job.
    const liveDelegate = await register(live.id, past.mun.id, past.product.id, 'CONFIRMED')

    const result = await purgeDeletedUserAnswers(now)

    expect(result.registrationsCleared).toBeGreaterThanOrEqual(2)
    expect(await answersOf(dueForPurge.id)).toEqual({ formResponses: null, accommodationAnswers: null })
    expect(await answersOf(attendedDueForPurge.id)).toEqual({ formResponses: null, accommodationAnswers: null })
    expect(await answersOf(stillNeeded.id)).toMatchObject({ formResponses: ANSWERS })
    expect(await answersOf(liveDelegate.id)).toMatchObject({ formResponses: ANSWERS })

    // Idempotent: a second run leaves the same end state.
    await purgeDeletedUserAnswers(now)
    expect(await answersOf(dueForPurge.id)).toEqual({ formResponses: null, accommodationAnswers: null })
    expect(await answersOf(stillNeeded.id)).toMatchObject({ formResponses: ANSWERS })

    await db
      .delete(registrations)
      .where(inArray(registrations.id, [dueForPurge.id, attendedDueForPurge.id, stillNeeded.id, liveDelegate.id]))
  })
})

afterAll(async () => {
  await db.$client.end()
})
