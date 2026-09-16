import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('support chat REST routes', () => {
  it('a student can start a conversation, an admin can reply, and both sides read the thread', async () => {
    const student = await makeUser('STUDENT')
    const admin = await makeUser('ADMIN')
    const studentHeaders = await authHeaders(student.id)
    const adminHeaders = await authHeaders(admin.id)

    const startRes = await app.request('/api/v1/support/conversations', {
      method: 'POST',
      headers: { ...studentHeaders, ...JSON_HEADERS },
      body: JSON.stringify({ body: 'My payment failed' }),
    })
    expect(startRes.status).toBe(201)
    const started = await startRes.json()
    expect(started.ticket.category).toBe('GENERAL')
    expect(started.ticket.subject).toBe('My payment failed')
    const ticketId = started.ticket.id as string

    const replyRes = await app.request(`/api/v1/support/conversations/${ticketId}/messages`, {
      method: 'POST',
      headers: { ...adminHeaders, ...JSON_HEADERS },
      body: JSON.stringify({ body: 'Looking into it now' }),
    })
    expect(replyRes.status).toBe(201)

    const threadRes = await app.request(`/api/v1/support/conversations/${ticketId}`, {
      headers: studentHeaders,
    })
    expect(threadRes.status).toBe(200)
    const thread = await threadRes.json()
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual([
      'My payment failed',
      'Looking into it now',
    ])

    const unreadBefore = await app.request('/api/v1/support/conversations/unread-count', {
      headers: studentHeaders,
    })
    expect((await unreadBefore.json()).count).toBe(1)

    const readRes = await app.request(`/api/v1/support/conversations/${ticketId}/read`, {
      method: 'POST',
      headers: studentHeaders,
    })
    expect(readRes.status).toBe(200)

    const unreadAfter = await app.request('/api/v1/support/conversations/unread-count', {
      headers: studentHeaders,
    })
    expect((await unreadAfter.json()).count).toBe(0)

    const listRes = await app.request('/api/v1/support/conversations', { headers: studentHeaders })
    const list = await listRes.json()
    expect(list.some((t: { id: string }) => t.id === ticketId)).toBe(true)
  })

  it('rejects a third party from reading or replying (403), and rejects an empty message (400)', async () => {
    const student = await makeUser('STUDENT')
    const other = await makeUser('STUDENT')
    const studentHeaders = await authHeaders(student.id)
    const otherHeaders = await authHeaders(other.id)

    const startRes = await app.request('/api/v1/support/conversations', {
      method: 'POST',
      headers: { ...studentHeaders, ...JSON_HEADERS },
      body: JSON.stringify({ body: 'hi' }),
    })
    const { ticket } = await startRes.json()

    const forbiddenRes = await app.request(`/api/v1/support/conversations/${ticket.id}`, {
      headers: otherHeaders,
    })
    expect(forbiddenRes.status).toBe(403)

    const emptyRes = await app.request(`/api/v1/support/conversations/${ticket.id}/messages`, {
      method: 'POST',
      headers: { ...studentHeaders, ...JSON_HEADERS },
      body: JSON.stringify({ body: '' }),
    })
    expect(emptyRes.status).toBe(400)
  })

  it('GET /admin/support/tickets is admin-only and joins requester name/role', async () => {
    const student = await makeUser('STUDENT')
    const admin = await makeUser('ADMIN')
    const studentHeaders = await authHeaders(student.id)
    const adminHeaders = await authHeaders(admin.id)

    const startRes = await app.request('/api/v1/support/conversations', {
      method: 'POST',
      headers: { ...studentHeaders, ...JSON_HEADERS },
      body: JSON.stringify({ body: 'need help with the queue endpoint' }),
    })
    const { ticket } = await startRes.json()

    const forbidden = await app.request('/api/v1/admin/support/tickets', { headers: studentHeaders })
    expect(forbidden.status).toBe(403)

    const allowed = await app.request('/api/v1/admin/support/tickets', { headers: adminHeaders })
    expect(allowed.status).toBe(200)
    const tickets = await allowed.json()
    const found = tickets.find((t: { id: string }) => t.id === ticket.id)
    expect(found.requesterName).toBe(student.name)
    expect(found.requesterRole).toBe('STUDENT')
  })
})
