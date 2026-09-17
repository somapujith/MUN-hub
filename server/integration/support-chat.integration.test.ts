import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { muns } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

vi.mock('@/lib/notifications/support-reply-email', () => ({
  notifySupportReply: vi.fn().mockResolvedValue(undefined),
}))

const app = createApp()

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function as(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN') {
  const user = await makeUser(role)
  const headers = await authHeaders(user.id)
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, ...JSON_HEADERS },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { user, call }
}

async function startTicket(requester: Awaited<ReturnType<typeof as>>, body = `help ${crypto.randomUUID()}`) {
  const res = await requester.call('POST', '/support/conversations', { body })
  expect(res.status).toBe(201)
  return (await res.json()).ticket as { id: string; subject: string }
}

describe('support conversation routes', () => {
  it('a student starts a conversation, staff reply, and both read the same thread', async () => {
    const student = await as('STUDENT')
    const admin = await as('ADMIN')

    const started = await student.call('POST', '/support/conversations', { body: 'My payment failed\nOrder 7' })
    expect(started.status).toBe(201)
    const { ticket, message } = await started.json()
    expect(ticket).toMatchObject({ category: 'GENERAL', subject: 'My payment failed', status: 'NEW', unread: false })
    expect(message).toMatchObject({ author: 'REQUESTER', body: 'My payment failed\nOrder 7' })

    const reply = await admin.call('POST', `/support/conversations/${ticket.id}/messages`, { body: 'Looking into it now' })
    expect(reply.status).toBe(201)
    const replied = await reply.json()
    expect(replied.message).toMatchObject({ author: 'STAFF', senderId: admin.user.id })
    expect(replied.ticket).toMatchObject({ status: 'WAITING', assignedTo: admin.user.id })

    const thread = await (await student.call('GET', `/support/conversations/${ticket.id}`)).json()
    expect(thread.viewer).toBe('REQUESTER')
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual(['My payment failed\nOrder 7', 'Looking into it now'])
    expect(thread.messages[1]).toMatchObject({ author: 'STAFF', senderId: null, senderName: null })
    expect(thread.ticket.assignedTo).toBeUndefined()

    const staffThread = await (await admin.call('GET', `/support/conversations/${ticket.id}`)).json()
    expect(staffThread.viewer).toBe('STAFF')
    expect(staffThread.ticket.requesterName).toBe(student.user.name)

    expect(await (await student.call('GET', '/support/conversations/unread-count')).json()).toEqual({ count: 1 })
    expect((await student.call('POST', `/support/conversations/${ticket.id}/read`)).status).toBe(200)
    expect(await (await student.call('GET', '/support/conversations/unread-count')).json()).toEqual({ count: 0 })

    const answer = await student.call('POST', `/support/conversations/${ticket.id}/messages`, { body: 'Order 7 it is' })
    expect((await answer.json()).ticket.status).toBe('IN_PROGRESS')

    const list = await (await student.call('GET', '/support/conversations?limit=10')).json()
    expect(list.total).toBe(1)
    expect(list.results[0]).toMatchObject({ id: ticket.id, status: 'IN_PROGRESS' })
  })

  it('the full form files a ticket whose description opens the thread', async () => {
    const student = await as('STUDENT')
    const res = await student.call('POST', '/support/tickets', {
      category: 'PAYMENT',
      priority: 'HIGH',
      subject: '  Charged twice ',
      description: 'Two debits for one seat.',
    })
    expect(res.status).toBe(201)
    const ticket = await res.json()
    expect(ticket).toMatchObject({ subject: 'Charged twice', category: 'PAYMENT', priority: 'HIGH', status: 'NEW' })

    const thread = await (await student.call('GET', `/support/conversations/${ticket.id}`)).json()
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual(['Two debits for one seat.'])
  })

  it('validates bodies strictly and bounds their length', async () => {
    const student = await as('STUDENT')
    const ticket = await startTicket(student)

    const bad: Array<[string, string, unknown]> = [
      ['POST', '/support/tickets', { category: 'REFUND', subject: 'x', description: 'y' }],
      ['POST', '/support/tickets', { category: 'COMPLAINTS', subject: 'x', description: 'y' }],
      ['POST', '/support/tickets', { category: 'PAYMENT', subject: '   ', description: 'y' }],
      ['POST', '/support/tickets', { category: 'PAYMENT', subject: 'x'.repeat(151), description: 'y' }],
      ['POST', '/support/tickets', { category: 'PAYMENT', subject: 'x', description: 'y', createdBy: 'someone' }],
      ['POST', '/support/tickets', { category: 'PAYMENT', subject: 'x', description: 'y', relatedMunId: 'not-a-uuid' }],
      ['POST', '/support/conversations', { body: '' }],
      ['POST', '/support/conversations', { body: 'x'.repeat(5001) }],
      ['POST', `/support/conversations/${ticket.id}/messages`, { body: '   ' }],
      ['POST', `/support/conversations/${ticket.id}/messages`, { body: 'hi', senderId: 'x' }],
      ['POST', `/support/conversations/${ticket.id}/messages`, { body: 'hi', nextStatus: 'RESOLVED' }],
    ]
    for (const [method, path, body] of bad) {
      const res = await student.call(method, path, body)
      expect(res.status, `${method} ${path} ${JSON.stringify(body).slice(0, 80)}`).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    }

    expect((await student.call('GET', '/support/conversations?limit=500')).status).toBe(400)
    expect((await student.call('GET', '/support/conversations?status=NEW')).status).toBe(400)
  })

  it('keeps every conversation private to its requester and staff', async () => {
    const owner = await as('STUDENT')
    const other = await as('STUDENT')
    const organizer = await as('ORGANIZER')
    const ticket = await startTicket(owner)

    for (const caller of [other, organizer]) {
      expect((await caller.call('GET', `/support/conversations/${ticket.id}`)).status).toBe(403)
      expect((await caller.call('POST', `/support/conversations/${ticket.id}/messages`, { body: 'hi' })).status).toBe(403)
      expect((await caller.call('POST', `/support/conversations/${ticket.id}/read`)).status).toBe(403)
      const list = await (await caller.call('GET', '/support/conversations')).json()
      expect(list.results.some((t: { id: string }) => t.id === ticket.id)).toBe(false)
    }

    // A requester can't steer the status of their own ticket.
    expect((await owner.call('POST', `/support/conversations/${ticket.id}/messages`, { body: 'x', nextStatus: 'IN_PROGRESS' })).status).toBe(403)
    expect((await owner.call('GET', `/support/conversations/${crypto.randomUUID()}`)).status).toBe(404)
  })

  it('requires a session everywhere', async () => {
    const id = crypto.randomUUID()
    const calls: Array<[string, string, unknown?]> = [
      ['GET', '/support/conversations'],
      ['GET', '/support/conversations/unread-count'],
      ['POST', '/support/conversations', { body: 'hi' }],
      ['POST', '/support/tickets', { category: 'PAYMENT', subject: 'x', description: 'y' }],
      ['GET', `/support/conversations/${id}`],
      ['POST', `/support/conversations/${id}/messages`, { body: 'hi' }],
      ['POST', `/support/conversations/${id}/read`],
      ['GET', '/admin/support/tickets'],
      ['GET', '/admin/support/unread-count'],
      ['POST', `/admin/support/tickets/${id}/assign`],
      ['PATCH', `/admin/support/tickets/${id}`, { status: 'WAITING' }],
    ]
    for (const [method, path, body] of calls) {
      const res = await app.request(`/api/v1${path}`, {
        method,
        headers: JSON_HEADERS,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it('an organizer can raise a ticket about their own MUN only', async () => {
    const organizer = await as('ORGANIZER')
    const stranger = await as('ORGANIZER')
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.user.id, name: 'Route MUN', slug: `route-mun-${crypto.randomUUID()}` })
      .returning()

    const own = await organizer.call('POST', '/support/conversations', { body: 'About our payouts', relatedMunId: mun.id })
    expect(own.status).toBe(201)
    expect((await own.json()).ticket.relatedMunId).toBe(mun.id)

    const foreign = await stranger.call('POST', '/support/tickets', {
      category: 'ORGANIZER',
      subject: 'x',
      description: 'y',
      relatedMunId: mun.id,
    })
    expect(foreign.status).toBe(403)
    const missing = await organizer.call('POST', '/support/tickets', {
      category: 'ORGANIZER',
      subject: 'x',
      description: 'y',
      relatedMunId: crypto.randomUUID(),
    })
    expect(missing.status).toBe(404)
  })
})

describe('staff support queue routes', () => {
  it('is staff-only', async () => {
    for (const role of ['STUDENT', 'ORGANIZER'] as const) {
      const caller = await as(role)
      expect((await caller.call('GET', '/admin/support/tickets')).status).toBe(403)
      expect((await caller.call('GET', '/admin/support/unread-count')).status).toBe(403)
      expect((await caller.call('POST', `/admin/support/tickets/${crypto.randomUUID()}/assign`)).status).toBe(403)
      expect((await caller.call('PATCH', `/admin/support/tickets/${crypto.randomUUID()}`, { status: 'WAITING' })).status).toBe(403)
    }
  })

  it('lists, filters and paginates with the requester joined in', async () => {
    const student = await as('STUDENT')
    const admin = await as('ADMIN')
    const tag = crypto.randomUUID()
    const first = await startTicket(student, `${tag} first`)
    const second = await startTicket(student, `${tag} second`)

    const res = await admin.call('GET', `/admin/support/tickets?q=${tag}&limit=1`)
    expect(res.status).toBe(200)
    const page = await res.json()
    expect(page.total).toBe(2)
    expect(page.results).toHaveLength(1)
    expect(page.results[0]).toMatchObject({ id: second.id, requesterName: student.user.name, requesterRole: 'STUDENT', unread: true })

    const next = await (await admin.call('GET', `/admin/support/tickets?q=${tag}&limit=1&offset=1`)).json()
    expect(next.results[0].id).toBe(first.id)

    const open = await (await admin.call('GET', `/admin/support/tickets?q=${tag}&status=OPEN&assignee=unassigned&category=GENERAL&priority=NORMAL`)).json()
    expect(open.total).toBe(2)
    const resolved = await (await admin.call('GET', `/admin/support/tickets?q=${tag}&status=RESOLVED`)).json()
    expect(resolved.total).toBe(0)

    for (const query of ['status=BOGUS', 'assignee=someone', 'limit=0', 'limit=101', 'foo=1', `q=${'x'.repeat(101)}`]) {
      expect((await admin.call('GET', `/admin/support/tickets?${query}`)).status, query).toBe(400)
    }

    const unread = await (await admin.call('GET', '/admin/support/unread-count')).json()
    expect(unread.count).toBeGreaterThanOrEqual(2)
  })

  it('works a ticket from NEW to CLOSED through assignment and guarded status changes', async () => {
    const student = await as('STUDENT')
    const admin = await as('ADMIN')
    const ticket = await startTicket(student)
    const patch = (body: unknown) => admin.call('PATCH', `/admin/support/tickets/${ticket.id}`, body)

    expect((await patch({ status: 'ASSIGNED' })).status).toBe(400)
    expect((await patch({ status: 'CLOSED' })).status).toBe(409)
    expect((await patch({ status: 'RESOLVED', resolutionNotes: 'skip' })).status).toBe(409)

    const assigned = await admin.call('POST', `/admin/support/tickets/${ticket.id}/assign`)
    expect(assigned.status).toBe(200)
    expect(await assigned.json()).toMatchObject({ status: 'ASSIGNED', assignedTo: admin.user.id })

    expect((await patch({ status: 'IN_PROGRESS' })).status).toBe(200)
    const noNote = await patch({ status: 'RESOLVED' })
    expect(noNote.status).toBe(400)
    expect((await noNote.json()).error.message).toBe('A resolution note is required')
    expect((await patch({ status: 'RESOLVED', resolutionNotes: 'x'.repeat(2001) })).status).toBe(400)

    const resolved = await patch({ status: 'RESOLVED', resolutionNotes: 'Webhook replayed' })
    expect(await resolved.json()).toMatchObject({ status: 'RESOLVED', resolutionNotes: 'Webhook replayed' })
    expect((await admin.call('POST', `/admin/support/tickets/${ticket.id}/assign`)).status).toBe(409)

    // The requester writes back: the ticket reopens.
    const followUp = await student.call('POST', `/support/conversations/${ticket.id}/messages`, { body: 'Still pending' })
    expect((await followUp.json()).ticket).toMatchObject({ status: 'IN_PROGRESS', resolutionNotes: null })

    expect((await patch({ status: 'RESOLVED', resolutionNotes: 'Confirmed now' })).status).toBe(200)
    expect((await patch({ status: 'CLOSED' })).status).toBe(200)

    const closedReply = await student.call('POST', `/support/conversations/${ticket.id}/messages`, { body: 'one more' })
    expect(closedReply.status).toBe(409)
    expect((await closedReply.json()).error.code).toBe('CONFLICT_STATE')

    expect((await admin.call('POST', `/admin/support/tickets/${crypto.randomUUID()}/assign`)).status).toBe(404)
    expect((await admin.call('PATCH', `/admin/support/tickets/${crypto.randomUUID()}`, { status: 'WAITING' })).status).toBe(404)
  })
})
