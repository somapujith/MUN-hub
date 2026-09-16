import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users, supportTickets, adminActions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createTicket,
  listTickets,
  assignTicket,
  updateTicketStatus,
  startConversation,
  sendMessage,
  getConversation,
  markConversationRead,
  listMyConversations,
  getUnreadConversationCount,
  getAdminUnreadConversationCount,
  listTicketsWithRequester,
} from './support'

describe('createTicket', () => {
  it('creates a NEW ticket with default NORMAL priority', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const ticket = await createTicket({ category: 'PAYMENT', subject: 'Payment failed', description: 'x' }, { userId: student.id, role: 'STUDENT' })
    expect(ticket.status).toBe('NEW')
    expect(ticket.priority).toBe('NORMAL')
    expect(ticket.createdBy).toBe(student.id)
  })

  it('throws Forbidden with no session', async () => {
    await expect(createTicket({ category: 'PAYMENT', subject: 'x', description: 'x' }, null)).rejects.toThrow('Forbidden')
  })
})

describe('assignTicket', () => {
  it('self-assigns to the acting session, sets status ASSIGNED, logs TICKET_ASSIGNED', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2', email: `s2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A', email: `a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    const assigned = await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    expect(assigned.status).toBe('ASSIGNED')
    expect(assigned.assignedTo).toBe(admin.id)

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(log.action).toBe('TICKET_ASSIGNED')
  })

  it('always assigns to whoever is calling, never a third party — two different admins each get self-assigned correctly', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2c', email: `s2c-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [adminOne] = await db
      .insert(users)
      .values({ name: 'A-one', email: `a-one-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const [adminTwo] = await db
      .insert(users)
      .values({ name: 'A-two', email: `a-two-${crypto.randomUUID()}@test.dev`, role: 'OPERATIONS' })
      .returning()

    const ticketOne = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })
    const ticketTwo = await createTicket({ category: 'ACCOUNT', subject: 'y', description: 'y' }, { userId: student.id, role: 'STUDENT' })

    const assignedOne = await assignTicket(ticketOne.id, { userId: adminOne.id, role: 'ADMIN' })
    expect(assignedOne.assignedTo).toBe(adminOne.id)

    const assignedTwo = await assignTicket(ticketTwo.id, { userId: adminTwo.id, role: 'OPERATIONS' })
    expect(assignedTwo.assignedTo).toBe(adminTwo.id)
    expect(assignedTwo.assignedTo).not.toBe(adminOne.id)
  })

  it('throws Forbidden for a student trying to assign a ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2b', email: `s2b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const ticket = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await expect(assignTicket(ticket.id, { userId: student.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })
})

describe('updateTicketStatus', () => {
  it('transitions ASSIGNED -> IN_PROGRESS -> RESOLVED with resolution notes, logs TICKET_RESOLVED', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S3', email: `s3-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A2', email: `a2-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, { userId: admin.id, role: 'ADMIN' })
    const resolved = await updateTicketStatus(ticket.id, 'RESOLVED', 'fixed it', { userId: admin.id, role: 'ADMIN' })
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.resolutionNotes).toBe('fixed it')

    const logs = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    const resolvedLog = logs.find((l) => l.action === 'TICKET_RESOLVED')
    expect(resolvedLog?.reason).toBe('fixed it')
  })

  it('does not log an admin action for a non-RESOLVED transition', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S3b', email: `s3b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A2b', email: `a2b-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    const inProgress = await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, { userId: admin.id, role: 'ADMIN' })
    expect(inProgress.status).toBe('IN_PROGRESS')

    const logs = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    // assignTicket already logged TICKET_ASSIGNED — assert no TICKET_RESOLVED
    // was added for the IN_PROGRESS transition, rather than asserting zero logs.
    expect(logs.some((l) => l.action === 'TICKET_RESOLVED')).toBe(false)
  })

  it('throws Forbidden for a student trying to resolve a ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S4', email: `s4-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await expect(updateTicketStatus(ticket.id, 'RESOLVED', undefined, { userId: student.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })

  it('allows a valid transition: ASSIGNED -> WAITING', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S5', email: `s5-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A3', email: `a3-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    const waiting = await updateTicketStatus(ticket.id, 'WAITING', undefined, { userId: admin.id, role: 'ADMIN' })
    expect(waiting.status).toBe('WAITING')
  })

  it('rejects an invalid transition: NEW -> RESOLVED (must be ASSIGNED first)', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S6', email: `s6-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A4', email: `a4-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await expect(updateTicketStatus(ticket.id, 'RESOLVED', 'skip ahead', { userId: admin.id, role: 'ADMIN' })).rejects.toThrow(
      'Invalid ticket transition',
    )
  })

  it('rejects RESOLVED -> RESOLVED (a resolved ticket cannot be re-resolved)', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S7', email: `s7-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A5', email: `a5-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'RESOLVED', 'done', { userId: admin.id, role: 'ADMIN' })

    await expect(updateTicketStatus(ticket.id, 'RESOLVED', 'done again', { userId: admin.id, role: 'ADMIN' })).rejects.toThrow(
      'Invalid ticket transition',
    )
  })

  it('rejects CLOSED -> NEW (a closed ticket cannot be reopened)', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S8', email: `s8-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'A6', email: `a6-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' }, { userId: student.id, role: 'STUDENT' })

    await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'RESOLVED', 'done', { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'CLOSED', undefined, { userId: admin.id, role: 'ADMIN' })

    await expect(updateTicketStatus(ticket.id, 'NEW', undefined, { userId: admin.id, role: 'ADMIN' })).rejects.toThrow('Invalid ticket transition')
  })
})

describe('startConversation', () => {
  it('creates a GENERAL ticket with a derived subject and the opening message, read by the requester', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C1', email: `c1-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()

    const { ticket, message } = await startConversation({ body: 'Hi, my payment failed' }, { userId: student.id, role: 'STUDENT' })
    expect(ticket.category).toBe('GENERAL')
    expect(ticket.subject).toBe('Hi, my payment failed')
    expect(ticket.lastMessageSenderId).toBe(student.id)
    expect(ticket.requesterReadAt).not.toBeNull()
    expect(message.body).toBe('Hi, my payment failed')
    expect(message.senderRole).toBe('STUDENT')
  })

  it('throws on an empty message', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C1b', email: `c1b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    await expect(startConversation({ body: '   ' }, { userId: student.id, role: 'STUDENT' })).rejects.toThrow('Message cannot be empty')
  })

  it('throws Forbidden with no session', async () => {
    await expect(startConversation({ body: 'hi' }, null)).rejects.toThrow('Forbidden')
  })
})

describe('sendMessage / getConversation / markConversationRead', () => {
  it('lets the requester and an admin exchange messages, ordered oldest first', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C2', email: `c2-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'C2a', email: `c2a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    const { ticket } = await startConversation({ body: 'first message' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'we are looking into it', { userId: admin.id, role: 'ADMIN' })
    await sendMessage(ticket.id, 'thanks!', { userId: student.id, role: 'STUDENT' })

    const { messages } = await getConversation(ticket.id, { userId: student.id, role: 'STUDENT' })
    expect(messages.map((m) => m.body)).toEqual(['first message', 'we are looking into it', 'thanks!'])
  })

  it('rejects a third party who is neither the requester nor an admin', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C3', email: `c3-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [other] = await db
      .insert(users)
      .values({ name: 'C3b', email: `c3b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()

    const { ticket } = await startConversation({ body: 'hi' }, { userId: student.id, role: 'STUDENT' })
    await expect(sendMessage(ticket.id, 'butting in', { userId: other.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
    await expect(getConversation(ticket.id, { userId: other.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })

  it('rejects new messages on a CLOSED ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C4', email: `c4-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'C4a', email: `c4a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    const { ticket } = await startConversation({ body: 'hi' }, { userId: student.id, role: 'STUDENT' })
    await assignTicket(ticket.id, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'RESOLVED', 'done', { userId: admin.id, role: 'ADMIN' })
    await updateTicketStatus(ticket.id, 'CLOSED', undefined, { userId: admin.id, role: 'ADMIN' })

    await expect(sendMessage(ticket.id, 'still broken', { userId: student.id, role: 'STUDENT' })).rejects.toThrow(
      'This conversation is closed.',
    )
  })

  it('markConversationRead clears unread for whichever side calls it', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C5', email: `c5-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'C5a', email: `c5a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    const { ticket } = await startConversation({ body: 'hi' }, { userId: student.id, role: 'STUDENT' })
    await sendMessage(ticket.id, 'reply', { userId: admin.id, role: 'ADMIN' })

    expect(await getUnreadConversationCount({ userId: student.id, role: 'STUDENT' })).toBe(1)
    await markConversationRead(ticket.id, { userId: student.id, role: 'STUDENT' })
    expect(await getUnreadConversationCount({ userId: student.id, role: 'STUDENT' })).toBe(0)
  })
})

describe('listMyConversations / getUnreadConversationCount / getAdminUnreadConversationCount', () => {
  it('lists only the caller\'s own tickets, most recent activity first', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C6', email: `c6-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [otherStudent] = await db
      .insert(users)
      .values({ name: 'C6b', email: `c6b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()

    const { ticket: older } = await startConversation({ body: 'older' }, { userId: student.id, role: 'STUDENT' })
    const { ticket: newer } = await startConversation({ body: 'newer' }, { userId: student.id, role: 'STUDENT' })
    await startConversation({ body: 'not mine' }, { userId: otherStudent.id, role: 'STUDENT' })

    const mine = await listMyConversations({ userId: student.id, role: 'STUDENT' })
    expect(mine.map((t) => t.id)).toEqual([newer.id, older.id])
  })

  it('getAdminUnreadConversationCount counts conversations awaiting an admin reply, and rejects non-admins', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'C7', email: `c7-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const [admin] = await db
      .insert(users)
      .values({ name: 'C7a', email: `c7a-${crypto.randomUUID()}@test.dev`, role: 'ADMIN' })
      .returning()

    const { ticket } = await startConversation({ body: 'needs a reply' }, { userId: student.id, role: 'STUDENT' })
    const before = await getAdminUnreadConversationCount({ userId: admin.id, role: 'ADMIN' })
    expect(before).toBeGreaterThanOrEqual(1)

    await markConversationRead(ticket.id, { userId: admin.id, role: 'ADMIN' })
    await sendMessage(ticket.id, 'here to help', { userId: admin.id, role: 'ADMIN' })

    await expect(getAdminUnreadConversationCount({ userId: student.id, role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })
})

describe('listTicketsWithRequester', () => {
  it('joins requester name/role onto each ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'Req One', email: `req1-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    const { ticket } = await startConversation({ body: 'need help' }, { userId: student.id, role: 'STUDENT' })

    const rows = await listTicketsWithRequester({}, { userId: 'admin-x', role: 'ADMIN' })
    const found = rows.find((r) => r.id === ticket.id)
    expect(found?.requesterName).toBe('Req One')
    expect(found?.requesterRole).toBe('STUDENT')
  })

  it('throws Forbidden for a non-admin', async () => {
    await expect(listTicketsWithRequester({}, { userId: 'student-x', role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })
})

describe('listTickets', () => {
  it('filters by status', async () => {
    const results = await listTickets({ status: 'NEW' }, { userId: 'admin-x', role: 'OPERATIONS' })
    expect(Array.isArray(results)).toBe(true)
    expect(results.every((t) => t.status === 'NEW')).toBe(true)
  })

  it('returns all tickets with no filter', async () => {
    const results = await listTickets({}, { userId: 'admin-x', role: 'OPERATIONS' })
    expect(Array.isArray(results)).toBe(true)
  })

  it('throws Forbidden for a student', async () => {
    await expect(listTickets({}, { userId: 'student-x', role: 'STUDENT' })).rejects.toThrow('Forbidden')
  })
})
