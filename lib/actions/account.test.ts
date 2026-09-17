import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { getAccountSettings, setEmailNotificationsEnabled } from './account'

async function createTestUser() {
  const email = `account-${Date.now()}-${Math.random()}@test.com`
  const [user] = await db.insert(users).values({ name: 'Test Account User', email, role: 'STUDENT' }).returning()
  const session: Session = { userId: user.id, role: 'STUDENT' }
  return { user, session }
}

describe('getAccountSettings', () => {
  it('returns name, email, phone, and emailNotificationsEnabled defaulting to true', async () => {
    const { user, session } = await createTestUser()

    await expect(getAccountSettings(session)).resolves.toEqual({
      name: user.name,
      email: user.email,
      phone: null,
      institution: null,
      emailNotificationsEnabled: true,
    })
  })

  it('returns the saved phone and institution, so registration can pre-fill it', async () => {
    const { user, session } = await createTestUser()
    await db.update(users).set({ phone: '9876500000', institution: 'E2E College' }).where(eq(users.id, user.id))

    await expect(getAccountSettings(session)).resolves.toMatchObject({ phone: '9876500000', institution: 'E2E College' })
  })

  it('throws "Account not found" for a session whose userId does not exist', async () => {
    const session: Session = { userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'STUDENT' }

    await expect(getAccountSettings(session)).rejects.toThrow('Account not found')
  })
})

describe('setEmailNotificationsEnabled', () => {
  it('sets it to false and getAccountSettings reflects the change', async () => {
    const { session } = await createTestUser()

    await setEmailNotificationsEnabled(false, session)

    await expect(getAccountSettings(session)).resolves.toMatchObject({ emailNotificationsEnabled: false })
  })

  it('round-trips back to true', async () => {
    const { session } = await createTestUser()

    await setEmailNotificationsEnabled(false, session)
    await setEmailNotificationsEnabled(true, session)

    await expect(getAccountSettings(session)).resolves.toMatchObject({ emailNotificationsEnabled: true })
  })
})

afterAll(async () => {
  await db.$client.end()
})
