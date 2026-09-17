import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { isEmailNotificationsEnabled } from './email-preference'

async function makeUser(emailNotificationsEnabled?: boolean) {
  const [user] = await db
    .insert(users)
    .values({
      name: 'Pref Test',
      email: `pref-${crypto.randomUUID()}@test.dev`,
      role: 'STUDENT',
      ...(emailNotificationsEnabled === undefined ? {} : { emailNotificationsEnabled }),
    })
    .returning()
  return user
}

describe('isEmailNotificationsEnabled', () => {
  it('defaults to true for a freshly created user', async () => {
    const user = await makeUser()
    expect(await isEmailNotificationsEnabled(user.id)).toBe(true)
  })

  it('returns false once the user has opted out', async () => {
    const user = await makeUser(false)
    expect(await isEmailNotificationsEnabled(user.id)).toBe(false)
  })

  it('returns true (fail open) for a user id that does not resolve', async () => {
    expect(await isEmailNotificationsEnabled('00000000-0000-0000-0000-000000000000')).toBe(true)
  })
})
