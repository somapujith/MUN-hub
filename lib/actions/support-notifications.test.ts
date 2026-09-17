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

async function makeStudentAndAdmin() {
  const [student] = await db
    .insert(users)
    .values({ name: 'S', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
    .returning()
  const [admin] = await db
    .insert(users)
    .values({ name: 'A', email: `a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
    .returning()
  return { student, admin }
}

describe('sendMessage support-reply notification wiring', () => {
  afterEach(() => {
    notifySupportReplyMock.mockReset()
    notifySupportReplyMock.mockResolvedValue(undefined)
    vi.restoreAllMocks()
  })

  it('fires notifySupportReply when staff (admin) replies', async () => {
    const { student, admin } = await makeStudentAndAdmin()

    const { ticket } = await startConversation({ body: 'Need help' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'We are looking into it', { userId: admin.id, role: 'ADMIN' })

    expect(notifySupportReplyMock).toHaveBeenCalledWith(ticket.id)
  })

  // On Workers, work still pending once the response is sent can be dropped,
  // so the email must be finished before sendMessage returns.
  it('does not resolve until the reply email has finished sending', async () => {
    const { student, admin } = await makeStudentAndAdmin()
    let delivered = false
    notifySupportReplyMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      delivered = true
    })

    const { ticket } = await startConversation({ body: 'Need help' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'We are looking into it', { userId: admin.id, role: 'ADMIN' })

    expect(delivered).toBe(true)
  })

  it('still returns the saved reply when the notification lookup fails', async () => {
    const { student, admin } = await makeStudentAndAdmin()
    notifySupportReplyMock.mockRejectedValue(new Error('Ticket not found'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { ticket } = await startConversation({ body: 'Need help' }, { userId: student.id, role: 'STUDENT' })
    const result = await sendMessage(ticket.id, 'We are looking into it', { userId: admin.id, role: 'ADMIN' })

    expect(result.message.body).toBe('We are looking into it')
    expect(errorSpy).toHaveBeenCalledWith('[support] reply notification failed', expect.any(Error))
  })

  it('does NOT fire notifySupportReply when the requester replies to their own ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2', email: `s2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()

    const { ticket } = await startConversation({ body: 'Need help' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'Still waiting', { userId: student.id, role: 'STUDENT' })

    expect(notifySupportReplyMock).not.toHaveBeenCalled()
  })
})

afterAll(async () => {
  await db.$client.end()
})
