import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { supportTickets, users } from '@/lib/db/schema'
import { notifySupportReply } from './support-reply-email'
import type { NotificationsAdapter } from './adapter'

function mockAdapter() {
  const send = vi.fn().mockResolvedValue(undefined)
  const adapter: NotificationsAdapter = { send }
  return { adapter, send }
}

async function makeTicket(role: 'STUDENT' | 'ORGANIZER', emailNotificationsEnabled = true) {
  const [requester] = await db
    .insert(users)
    .values({ name: 'Requester', email: `req-${crypto.randomUUID()}@test.dev`, role, emailNotificationsEnabled })
    .returning()
  const [ticket] = await db
    .insert(supportTickets)
    .values({ createdBy: requester.id, category: 'GENERAL', subject: 'Cannot upload my logo', description: 'Cannot upload my logo' })
    .returning()
  return { requester, ticket }
}

describe('notifySupportReply', () => {
  it('emails the requester with a deep link straight to the ticket in their organizer support inbox', async () => {
    const { requester, ticket } = await makeTicket('ORGANIZER')
    const { adapter, send } = mockAdapter()

    await notifySupportReply(ticket.id, adapter)

    expect(send).toHaveBeenCalledTimes(1)
    const call = send.mock.calls[0][0]
    expect(call.to).toBe(requester.email)
    expect(call.subject).toContain('Cannot upload my logo')
    expect(call.body).toContain(`/organizer/support?ticket=${ticket.id}`)
  })

  it('emails the requester with a deep link straight to the ticket in their student dashboard inbox', async () => {
    const { requester, ticket } = await makeTicket('STUDENT')
    const { adapter, send } = mockAdapter()

    await notifySupportReply(ticket.id, adapter)

    expect(send.mock.calls[0][0].body).toContain(`/dashboard/support?ticket=${ticket.id}`)
    expect(send.mock.calls[0][0].to).toBe(requester.email)
  })

  it('does not send when the requester has opted out of email notifications', async () => {
    const { ticket } = await makeTicket('STUDENT', false)
    const { adapter, send } = mockAdapter()

    await notifySupportReply(ticket.id, adapter)

    expect(send).not.toHaveBeenCalled()
  })

  it('throws for a ticket id that does not resolve', async () => {
    const { adapter } = mockAdapter()
    await expect(notifySupportReply('00000000-0000-0000-0000-000000000000', adapter)).rejects.toThrow('Ticket not found')
  })
})
