import { describe, expect, it, vi } from 'vitest'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportTickets } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { makeUser } from './helpers'

vi.mock('@/lib/actions/telegram', () => ({
  notifyStaffNewTicket: vi.fn().mockResolvedValue(undefined),
  notifyStaffTicketReply: vi.fn().mockResolvedValue(undefined),
}))

const app = createApp()
const JSON_HEADERS = { 'Content-Type': 'application/json' }

function post(body: unknown) {
  return app.request('/api/v1/contact', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
}

describe('POST /contact', () => {
  it('files a ticket with no session required', async () => {
    await makeUser('ADMIN')

    const res = await post({
      category: 'GENERAL',
      name: 'Public Visitor',
      email: 'visitor@example.com',
      phone: '9000000000',
      message: 'Do you list conferences in Bengaluru?',
    })
    expect(res.status).toBe(204)

    const [ticket] = await db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(1)
    expect(ticket.category).toBe('GENERAL')
    expect(ticket.description).toContain('Name: Public Visitor')
    expect(ticket.description).toContain('Do you list conferences in Bengaluru?')
  })

  it('rejects a missing required field with 400', async () => {
    const res = await post({ category: 'GENERAL', name: '', email: 'visitor@example.com', phone: '9000000000' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('rejects an invalid category with 400', async () => {
    const res = await post({
      category: 'NOT_A_REAL_CATEGORY',
      name: 'Someone',
      email: 'visitor@example.com',
      phone: '9000000000',
    })
    expect(res.status).toBe(400)
  })

  it('accepts a tripped honeypot but silently drops it (no ticket written)', async () => {
    await makeUser('ADMIN')
    const before = await db.$count(supportTickets)

    const res = await post({
      category: 'GENERAL',
      name: 'Bot',
      email: 'bot@example.com',
      phone: '9000000000',
      website: 'https://spam.example',
    })
    expect(res.status).toBe(204)

    const after = await db.$count(supportTickets)
    expect(after).toBe(before)
  })
})
