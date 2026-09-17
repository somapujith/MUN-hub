import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { notifyWelcome } from './welcome-email'
import type { NotificationsAdapter } from './adapter'

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

describe('notifyWelcome', () => {
  it('sends a welcome email to a new user', async () => {
    const [user] = await db
      .insert(users)
      .values({ name: 'New Student', email: `new-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const { adapter, send } = mockAdapter()

    await notifyWelcome(user.id, adapter)

    expect(send).toHaveBeenCalledWith({
      to: user.email,
      subject: expect.stringContaining('Welcome'),
      body: expect.stringContaining('New Student'),
    })
  })

  it('does not send when the user has opted out of email notifications', async () => {
    const [user] = await db
      .insert(users)
      .values({
        name: 'Opted Out',
        email: `optout-${crypto.randomUUID()}@test.dev`,
        role: 'STUDENT',
        emailNotificationsEnabled: false,
      })
      .returning()
    const { adapter, send } = mockAdapter()

    await notifyWelcome(user.id, adapter)

    expect(send).not.toHaveBeenCalled()
  })

  it('throws for a user id that does not resolve', async () => {
    const { adapter } = mockAdapter()
    await expect(notifyWelcome('00000000-0000-0000-0000-000000000000', adapter)).rejects.toThrow('User not found')
  })
})
