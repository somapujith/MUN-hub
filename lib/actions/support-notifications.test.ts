import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

// Same dedicated-file, vi.mock-per-surface precedent as
// lib/lifecycle/go-live-notifications.test.ts / lib/actions/admin-review-notifications.test.ts.

const notifySupportReplyMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/notifications/support-reply-email', () => ({
  notifySupportReply: (...args: unknown[]) => notifySupportReplyMock(...args),
}))

const { startConversation, sendMessage } = await import('./support')

async function waitForCalls(minCalls: number, timeoutMs = 300): Promise<void> {
  const baseline = notifySupportReplyMock.mock.calls.length
  const deadline = Date.now() + timeoutMs
  while (notifySupportReplyMock.mock.calls.length - baseline < minCalls && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('sendMessage support-reply notification wiring', () => {
  afterEach(() => {
    notifySupportReplyMock.mockClear()
  })

  it('fires notifySupportReply when staff (admin) replies', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A', email: `a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    const { ticket } = await startConversation({ body: 'Need help' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'We are looking into it', { userId: admin.id, role: 'ADMIN' })

    await waitForCalls(1)
    expect(notifySupportReplyMock).toHaveBeenCalledWith(ticket.id)
  })

  it('does NOT fire notifySupportReply when the requester replies to their own ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2', email: `s2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()

    const { ticket } = await startConversation({ body: 'Need help' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'Still waiting', { userId: student.id, role: 'STUDENT' })

    await waitForCalls(0)
    expect(notifySupportReplyMock).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await db.$client.end()
})
