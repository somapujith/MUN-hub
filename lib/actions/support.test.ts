import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, muns, registrationProducts, registrations, supportMessages, supportTickets, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { Role } from '@/lib/db/schema-enums'
import {
  ALLOWED_TICKET_TRANSITIONS,
  REQUESTER_CATEGORIES,
  SUPPORT_LIMITS,
  assignTicket,
  canTransitionTicket,
  createTicket,
  getAdminUnreadConversationCount,
  getConversation,
  getUnreadConversationCount,
  listMyConversations,
  listStaffTickets,
  listTickets,
  markConversationRead,
  sendMessage,
  startConversation,
  statusAfterRequesterReply,
  statusAfterStaffReply,
  updateTicketStatus,
} from './support'

// The reply email is covered by support-notifications.test.ts; here it would
// only leave fire-and-forget DB reads running past the end of the file.
vi.mock('@/lib/notifications/support-reply-email', () => ({
  notifySupportReply: vi.fn().mockResolvedValue(undefined),
}))

async function makeUser(role: Role, name: string = role): Promise<Session & { name: string; email: string }> {
  const [user] = await db
    .insert(users)
    .values({ name, email: `support-${role.toLowerCase()}-${crypto.randomUUID()}@test.dev`, role })
    .returning()
  return { userId: user.id, role: user.role, name: user.name, email: user.email }
}

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Support Test MUN', slug: `support-test-${crypto.randomUUID()}` })
    .returning()
  return mun
}

async function makeRegistration(userId: string, munId: string) {
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId, name: 'Delegate', price: 1000, capacity: 10 })
    .returning()
  const [registration] = await db
    .insert(registrations)
    .values({ userId, munId, registrationProductId: product.id })
    .returning()
  return registration
}

/** A ticket in a given status, reached through the real transitions. */
async function ticketIn(status: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED') {
  const requester = await makeUser('STUDENT')
  const staff = await makeUser('ADMIN')
  const { ticket } = await startConversation({ body: `ticket in ${status}` }, requester)
  if (status === 'NEW') return { ticket, requester, staff }
  await assignTicket(ticket.id, staff)
  if (status === 'ASSIGNED') return { ticket, requester, staff }
  await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, staff)
  if (status === 'IN_PROGRESS') return { ticket, requester, staff }
  if (status === 'WAITING') {
    await updateTicketStatus(ticket.id, 'WAITING', undefined, staff)
    return { ticket, requester, staff }
  }
  await updateTicketStatus(ticket.id, 'RESOLVED', 'Sorted it out', staff)
  if (status === 'RESOLVED') return { ticket, requester, staff }
  await updateTicketStatus(ticket.id, 'CLOSED', undefined, staff)
  return { ticket, requester, staff }
}

async function statusOf(ticketId: string) {
  const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId))
  return row
}

describe('ticket state machine (pure)', () => {
  it('only allows the documented transitions', () => {
    expect(canTransitionTicket('NEW', 'ASSIGNED')).toBe(true)
    expect(canTransitionTicket('NEW', 'RESOLVED')).toBe(false)
    expect(canTransitionTicket('NEW', 'CLOSED')).toBe(false)
    expect(canTransitionTicket('ASSIGNED', 'RESOLVED')).toBe(false)
    expect(canTransitionTicket('RESOLVED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionTicket('RESOLVED', 'RESOLVED')).toBe(false)
    expect(ALLOWED_TICKET_TRANSITIONS.CLOSED).toEqual([])
  })

  it('a staff reply leaves the ticket waiting on the requester unless told otherwise', () => {
    expect(statusAfterStaffReply('NEW')).toBe('WAITING')
    expect(statusAfterStaffReply('ASSIGNED')).toBe('WAITING')
    expect(statusAfterStaffReply('IN_PROGRESS')).toBe('WAITING')
    expect(statusAfterStaffReply('IN_PROGRESS', 'IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(statusAfterStaffReply('WAITING', 'IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(statusAfterStaffReply('RESOLVED')).toBe('RESOLVED')
    expect(() => statusAfterStaffReply('CLOSED')).toThrow('This conversation is closed.')
  })

  it('a requester reply hands the ticket back to staff and reopens a resolved one', () => {
    expect(statusAfterRequesterReply('NEW')).toBe('NEW')
    expect(statusAfterRequesterReply('ASSIGNED')).toBe('ASSIGNED')
    expect(statusAfterRequesterReply('IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(statusAfterRequesterReply('WAITING')).toBe('IN_PROGRESS')
    expect(statusAfterRequesterReply('RESOLVED')).toBe('IN_PROGRESS')
    expect(() => statusAfterRequesterReply('CLOSED')).toThrow('This conversation is closed.')
  })

  it('never offers the Refund category', () => {
    expect(REQUESTER_CATEGORIES).not.toContain('REFUND')
    expect(REQUESTER_CATEGORIES).toContain('GENERAL')
  })
})

describe('createTicket', () => {
  it('creates a NEW ticket whose description is the first message of the thread', async () => {
    const student = await makeUser('STUDENT')
    const ticket = await createTicket(
      { category: 'PAYMENT', subject: '  Payment failed  ', description: '  I was charged twice.  ' },
      student,
    )
    expect(ticket).toMatchObject({
      status: 'NEW',
      priority: 'NORMAL',
      createdBy: student.userId,
      subject: 'Payment failed',
      description: 'I was charged twice.',
      unread: false,
    })

    const conversation = await getConversation(ticket.id, student)
    expect(conversation.messages.map((m) => [m.author, m.body])).toEqual([['REQUESTER', 'I was charged twice.']])
    expect(await getAdminUnreadConversationCount(await makeUser('OPERATIONS'))).toBeGreaterThanOrEqual(1)
  })

  it('rejects a missing session, blank fields, overlong text and the Refund category', async () => {
    const student = await makeUser('STUDENT')
    await expect(createTicket({ category: 'PAYMENT', subject: 'x', description: 'x' }, null)).rejects.toThrow('Forbidden')
    await expect(createTicket({ category: 'PAYMENT', subject: '   ', description: 'x' }, student)).rejects.toThrow(
      'Subject is required',
    )
    await expect(createTicket({ category: 'PAYMENT', subject: 'x', description: '' }, student)).rejects.toThrow(
      'Description is required',
    )
    await expect(
      createTicket({ category: 'PAYMENT', subject: 'x'.repeat(SUPPORT_LIMITS.subject + 1), description: 'x' }, student),
    ).rejects.toThrow('Subject must be at most')
    await expect(createTicket({ category: 'REFUND', subject: 'x', description: 'x' }, student)).rejects.toThrow(
      'A supported category is required',
    )
  })

  it('lets an organizer reference only a MUN they run', async () => {
    const organizer = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.userId)

    const ticket = await createTicket(
      { category: 'ORGANIZER', subject: 'Payout', description: 'When?', relatedMunId: mun.id },
      organizer,
    )
    expect(ticket.relatedMunId).toBe(mun.id)

    await expect(
      createTicket({ category: 'ORGANIZER', subject: 'x', description: 'y', relatedMunId: mun.id }, stranger),
    ).rejects.toThrow('Forbidden')
    await expect(
      createTicket({ category: 'ORGANIZER', subject: 'x', description: 'y', relatedMunId: crypto.randomUUID() }, organizer),
    ).rejects.toThrow('Mun not found')
  })

  it('lets a delegate reference only their own registration, and the organizer of that MUN reference it too', async () => {
    const organizer = await makeUser('ORGANIZER')
    const delegate = await makeUser('STUDENT')
    const otherDelegate = await makeUser('STUDENT')
    const mun = await makeMun(organizer.userId)
    const registration = await makeRegistration(delegate.userId, mun.id)

    const own = await createTicket(
      { category: 'REGISTRATION', subject: 'Seat', description: 'x', relatedRegistrationId: registration.id, relatedMunId: mun.id },
      delegate,
    )
    expect(own.relatedRegistrationId).toBe(registration.id)

    await expect(
      createTicket({ category: 'ORGANIZER', subject: 'x', description: 'y', relatedRegistrationId: registration.id }, organizer),
    ).resolves.toMatchObject({ relatedRegistrationId: registration.id })

    await expect(
      createTicket({ category: 'REGISTRATION', subject: 'x', description: 'y', relatedRegistrationId: registration.id }, otherDelegate),
    ).rejects.toThrow('Forbidden')
    await expect(
      createTicket({ category: 'REGISTRATION', subject: 'x', description: 'y', relatedMunId: mun.id }, otherDelegate),
    ).rejects.toThrow('Forbidden')
  })
})

describe('startConversation', () => {
  it('creates a GENERAL ticket titled from the first line, read by the requester', async () => {
    const student = await makeUser('STUDENT')
    const { ticket, message } = await startConversation({ body: 'Hi, my payment failed\nOrder 42' }, student)
    expect(ticket.category).toBe('GENERAL')
    expect(ticket.subject).toBe('Hi, my payment failed')
    expect(ticket.unread).toBe(false)
    expect(message).toMatchObject({ body: 'Hi, my payment failed\nOrder 42', author: 'REQUESTER', senderRole: 'STUDENT' })
  })

  it('shortens a long first line for the subject', async () => {
    const student = await makeUser('STUDENT')
    const { ticket } = await startConversation({ body: 'a'.repeat(200) }, student)
    expect(ticket.subject.length).toBe(80)
    expect(ticket.subject.endsWith('…')).toBe(true)
  })

  it('throws on an empty or overlong message, and without a session', async () => {
    const student = await makeUser('STUDENT')
    await expect(startConversation({ body: '   ' }, student)).rejects.toThrow('Message cannot be empty')
    await expect(startConversation({ body: 'x'.repeat(SUPPORT_LIMITS.body + 1) }, student)).rejects.toThrow(
      'Message must be at most',
    )
    await expect(startConversation({ body: 'hi' }, null)).rejects.toThrow('Forbidden')
  })
})

describe('sendMessage', () => {
  it('lets the requester and staff exchange messages, oldest first, with staff shown as the support team', async () => {
    const { ticket, requester, staff } = await ticketIn('NEW')
    await sendMessage(ticket.id, 'we are looking into it', staff)
    await sendMessage(ticket.id, 'thanks!', requester)

    const requesterView = await getConversation(ticket.id, requester)
    expect(requesterView.viewer).toBe('REQUESTER')
    expect(requesterView.messages.map((m) => m.body)).toEqual(['ticket in NEW', 'we are looking into it', 'thanks!'])
    const staffMessage = requesterView.messages[1]
    expect(staffMessage).toMatchObject({ author: 'STAFF', senderId: null, senderName: null })
    expect(requesterView.ticket).not.toHaveProperty('assignedTo')
    expect(requesterView.ticket).not.toHaveProperty('adminReadAt')

    const staffView = await getConversation(ticket.id, staff)
    expect(staffView.viewer).toBe('STAFF')
    expect(staffView.messages[1]).toMatchObject({ author: 'STAFF', senderId: staff.userId, senderName: staff.name })
    if (staffView.viewer === 'STAFF') expect(staffView.ticket.requesterName).toBe(requester.name)
  })

  it('a staff reply to a NEW ticket assigns it to the replier and waits on the requester', async () => {
    const { ticket, staff } = await ticketIn('NEW')
    const { ticket: after } = await sendMessage(ticket.id, 'Can you send your order id?', staff)
    expect(after.status).toBe('WAITING')
    expect(after).toMatchObject({ assignedTo: staff.userId })

    const logs = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(logs.map((l) => l.action)).toContain('TICKET_ASSIGNED')
  })

  it('a staff reply can keep the ticket in progress', async () => {
    const { ticket, staff } = await ticketIn('ASSIGNED')
    const { ticket: after } = await sendMessage(ticket.id, 'Working on it', staff, { nextStatus: 'IN_PROGRESS' })
    expect(after.status).toBe('IN_PROGRESS')
  })

  it('only staff may choose the next status', async () => {
    const { ticket, requester } = await ticketIn('NEW')
    await expect(sendMessage(ticket.id, 'hi', requester, { nextStatus: 'IN_PROGRESS' })).rejects.toThrow('Forbidden')
  })

  it('a requester reply to a WAITING ticket hands it back to staff', async () => {
    const { ticket, requester } = await ticketIn('WAITING')
    const { ticket: after } = await sendMessage(ticket.id, 'Here is my order id', requester)
    expect(after.status).toBe('IN_PROGRESS')
  })

  it('a requester reply reopens a RESOLVED ticket and clears the old resolution note', async () => {
    const { ticket, requester } = await ticketIn('RESOLVED')
    expect((await statusOf(ticket.id)).resolutionNotes).toBe('Sorted it out')
    const { ticket: after } = await sendMessage(ticket.id, 'Actually it is still broken', requester)
    expect(after.status).toBe('IN_PROGRESS')
    expect(after.resolutionNotes).toBeNull()
  })

  it('a staff follow-up on a RESOLVED ticket keeps it resolved', async () => {
    const { ticket, staff } = await ticketIn('RESOLVED')
    const { ticket: after } = await sendMessage(ticket.id, 'Let us know if anything else comes up', staff)
    expect(after.status).toBe('RESOLVED')
  })

  it('rejects messages on a CLOSED ticket from either side', async () => {
    const { ticket, requester, staff } = await ticketIn('CLOSED')
    await expect(sendMessage(ticket.id, 'still broken', requester)).rejects.toThrow('This conversation is closed.')
    await expect(sendMessage(ticket.id, 'note', staff)).rejects.toThrow('This conversation is closed.')
  })

  it('rejects a third party, an unknown ticket and an empty message', async () => {
    const { ticket, requester } = await ticketIn('NEW')
    const other = await makeUser('STUDENT')
    const organizer = await makeUser('ORGANIZER')
    await expect(sendMessage(ticket.id, 'butting in', other)).rejects.toThrow('Forbidden')
    await expect(sendMessage(ticket.id, 'butting in', organizer)).rejects.toThrow('Forbidden')
    await expect(getConversation(ticket.id, other)).rejects.toThrow('Forbidden')
    await expect(markConversationRead(ticket.id, other)).rejects.toThrow('Forbidden')
    await expect(sendMessage(crypto.randomUUID(), 'hello', requester)).rejects.toThrow('Ticket not found')
    await expect(sendMessage(ticket.id, '  ', requester)).rejects.toThrow('Message cannot be empty')

    const messages = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, ticket.id))
    expect(messages).toHaveLength(1)
  })

  it('keeps messages in write order when replies race', async () => {
    const { ticket, requester, staff } = await ticketIn('ASSIGNED')
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => sendMessage(ticket.id, `msg ${i}`, i % 2 ? staff : requester)),
    )
    const { messages } = await getConversation(ticket.id, staff)
    expect(messages).toHaveLength(7)
    const times = messages.map((m) => m.createdAt.getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id))
    const lastWritten = messages[messages.length - 1]
    expect(row.lastMessageSenderId).toBe(lastWritten.senderId)
  })
})

describe('unread state', () => {
  it('counts a staff reply as unread for the requester until they read it', async () => {
    const { ticket, requester, staff } = await ticketIn('NEW')
    await sendMessage(ticket.id, 'reply', staff)

    expect(await getUnreadConversationCount(requester)).toBe(1)
    expect((await listMyConversations(requester)).results[0]).toMatchObject({ id: ticket.id, unread: true, lastMessageFromStaff: true })

    await markConversationRead(ticket.id, requester)
    expect(await getUnreadConversationCount(requester)).toBe(0)
    expect((await listMyConversations(requester)).results[0].unread).toBe(false)
  })

  it('counts a requester message as unread for staff until any staff member opens it', async () => {
    const requester = await makeUser('STUDENT')
    const staff = await makeUser('ADMIN')
    const subject = `unread-${crypto.randomUUID()}`
    const { ticket } = await startConversation({ body: subject }, requester)

    const before = await listStaffTickets({ q: subject }, staff)
    expect(before.results[0]).toMatchObject({ id: ticket.id, unread: true })

    await markConversationRead(ticket.id, staff)
    const after = await listStaffTickets({ q: subject }, staff)
    expect(after.results[0].unread).toBe(false)

    await expect(getAdminUnreadConversationCount(requester)).rejects.toThrow('Forbidden')
    expect(await getUnreadConversationCount(null)).toBe(0)
  })
})

describe('listMyConversations', () => {
  it('lists only the caller\'s own tickets, most recent activity first, paginated', async () => {
    const student = await makeUser('STUDENT')
    const other = await makeUser('STUDENT')
    const staff = await makeUser('ADMIN')

    const { ticket: first } = await startConversation({ body: 'first' }, student)
    const { ticket: second } = await startConversation({ body: 'second' }, student)
    const { ticket: third } = await startConversation({ body: 'third' }, student)
    await startConversation({ body: 'not mine' }, other)

    // Activity on the oldest ticket moves it to the top.
    await sendMessage(first.id, 'bump', staff)

    const all = await listMyConversations(student)
    expect(all.total).toBe(3)
    expect(all.results.map((t) => t.id)).toEqual([first.id, third.id, second.id])

    const page = await listMyConversations(student, { limit: 2, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.results.map((t) => t.id)).toEqual([third.id, second.id])

    await expect(listMyConversations(null)).rejects.toThrow('Forbidden')
  })
})

describe('listStaffTickets', () => {
  it('joins the requester, assignee and related MUN, and is staff-only', async () => {
    const organizer = await makeUser('ORGANIZER', 'Queue Organizer')
    const staff = await makeUser('OPERATIONS', 'Queue Staff')
    const mun = await makeMun(organizer.userId)
    const subject = `joined-${crypto.randomUUID()}`
    const ticket = await createTicket(
      { category: 'ORGANIZER', subject, description: 'x', relatedMunId: mun.id },
      organizer,
    )
    await assignTicket(ticket.id, staff)

    const { results, total } = await listStaffTickets({ q: subject }, staff)
    expect(total).toBe(1)
    expect(results[0]).toMatchObject({
      id: ticket.id,
      requesterName: 'Queue Organizer',
      requesterEmail: organizer.email,
      requesterRole: 'ORGANIZER',
      assignedTo: staff.userId,
      assigneeName: 'Queue Staff',
      relatedMunName: 'Support Test MUN',
    })

    await expect(listStaffTickets({}, organizer)).rejects.toThrow('Forbidden')
    await expect(listStaffTickets({}, null)).rejects.toThrow('Forbidden')
  })

  it('filters by status group, category, priority, assignee and search, and paginates', async () => {
    const requester = await makeUser('STUDENT', `Searchable ${crypto.randomUUID()}`)
    const staff = await makeUser('ADMIN')
    const tag = crypto.randomUUID()

    const a = await createTicket({ category: 'PAYMENT', priority: 'HIGH', subject: `${tag} a`, description: 'x' }, requester)
    const b = await createTicket({ category: 'ACCOUNT', subject: `${tag} b`, description: 'x' }, requester)
    const c = await createTicket({ category: 'ACCOUNT', subject: `${tag} c`, description: 'x' }, requester)
    await assignTicket(b.id, staff)
    await assignTicket(c.id, staff)
    await updateTicketStatus(c.id, 'IN_PROGRESS', undefined, staff)
    await updateTicketStatus(c.id, 'RESOLVED', 'done', staff)

    const ids = async (filters: Parameters<typeof listStaffTickets>[0]) =>
      (await listStaffTickets({ q: tag, ...filters }, staff)).results.map((t) => t.id).sort()

    expect(await ids({})).toEqual([a.id, b.id, c.id].sort())
    expect(await ids({ status: 'OPEN' })).toEqual([a.id, b.id].sort())
    expect(await ids({ status: 'RESOLVED' })).toEqual([c.id])
    expect(await ids({ category: 'ACCOUNT' })).toEqual([b.id, c.id].sort())
    expect(await ids({ priority: 'HIGH' })).toEqual([a.id])
    expect(await ids({ assignee: 'unassigned' })).toEqual([a.id])
    expect(await ids({ assignee: 'me' })).toEqual([b.id, c.id].sort())

    // Search by requester name and by exact ticket id.
    expect((await listStaffTickets({ q: requester.name }, staff)).total).toBe(3)
    expect((await listStaffTickets({ q: a.id }, staff)).results.map((t) => t.id)).toEqual([a.id])
    // LIKE wildcards are matched literally.
    expect((await listStaffTickets({ q: `${tag}%` }, staff)).total).toBe(0)

    const page = await listStaffTickets({ q: tag, limit: 2 }, staff)
    expect(page.total).toBe(3)
    expect(page.results).toHaveLength(2)
    const rest = await listStaffTickets({ q: tag, limit: 2, offset: 2 }, staff)
    expect(rest.results).toHaveLength(1)
    expect(new Set([...page.results, ...rest.results].map((t) => t.id)).size).toBe(3)
  })
})

describe('assignTicket', () => {
  it('self-assigns a NEW ticket, moves it to ASSIGNED and logs TICKET_ASSIGNED', async () => {
    const { ticket, staff } = await ticketIn('NEW')
    const assigned = await assignTicket(ticket.id, staff)
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignedTo: staff.userId })

    const logs = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetId, ticket.id), eq(adminActions.action, 'TICKET_ASSIGNED')))
    expect(logs).toHaveLength(1)
  })

  it('lets another staff member take over an open ticket without resetting its status', async () => {
    const { ticket } = await ticketIn('IN_PROGRESS')
    const other = await makeUser('OPERATIONS')
    const takenOver = await assignTicket(ticket.id, other)
    expect(takenOver).toMatchObject({ status: 'IN_PROGRESS', assignedTo: other.userId })
  })

  it('is a no-op (no extra audit row) when the caller already holds the ticket', async () => {
    const { ticket, staff } = await ticketIn('ASSIGNED')
    await assignTicket(ticket.id, staff)
    const logs = await db
      .select()
      .from(adminActions)
      .where(and(eq(adminActions.targetId, ticket.id), eq(adminActions.action, 'TICKET_ASSIGNED')))
    expect(logs).toHaveLength(1)
  })

  it('refuses resolved or closed tickets and unknown ids', async () => {
    const resolved = await ticketIn('RESOLVED')
    const closed = await ticketIn('CLOSED')
    await expect(assignTicket(resolved.ticket.id, resolved.staff)).rejects.toThrow('Invalid ticket transition: RESOLVED -> ASSIGNED')
    await expect(assignTicket(closed.ticket.id, closed.staff)).rejects.toThrow('Invalid ticket transition: CLOSED -> ASSIGNED')
    expect((await statusOf(closed.ticket.id)).status).toBe('CLOSED')
    await expect(assignTicket(crypto.randomUUID(), resolved.staff)).rejects.toThrow('Ticket not found')
  })

  it('is staff-only', async () => {
    const { ticket, requester } = await ticketIn('NEW')
    await expect(assignTicket(ticket.id, requester)).rejects.toThrow('Forbidden')
    await expect(assignTicket(ticket.id, await makeUser('ORGANIZER'))).rejects.toThrow('Forbidden')
  })
})

describe('updateTicketStatus', () => {
  it('resolves with a note, logs TICKET_RESOLVED, and the requester sees the note', async () => {
    const { ticket, requester, staff } = await ticketIn('IN_PROGRESS')
    const resolved = await updateTicketStatus(ticket.id, 'RESOLVED', '  Fixed the payment  ', staff)
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolutionNotes: 'Fixed the payment' })

    const logs = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(logs.find((l) => l.action === 'TICKET_RESOLVED')?.reason).toBe('Fixed the payment')
    expect((await getConversation(ticket.id, requester)).ticket.resolutionNotes).toBe('Fixed the payment')
  })

  it('requires a resolution note to resolve', async () => {
    const { ticket, staff } = await ticketIn('IN_PROGRESS')
    await expect(updateTicketStatus(ticket.id, 'RESOLVED', undefined, staff)).rejects.toThrow('A resolution note is required')
    await expect(updateTicketStatus(ticket.id, 'RESOLVED', '   ', staff)).rejects.toThrow('A resolution note is required')
    expect((await statusOf(ticket.id)).status).toBe('IN_PROGRESS')
  })

  it('does not log an admin action for a non-RESOLVED transition', async () => {
    const { ticket, staff } = await ticketIn('ASSIGNED')
    await updateTicketStatus(ticket.id, 'WAITING', undefined, staff)
    const logs = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(logs.some((l) => l.action === 'TICKET_RESOLVED')).toBe(false)
  })

  it('rejects skipping ahead, re-resolving, reopening a closed ticket and setting ASSIGNED directly', async () => {
    const fresh = await ticketIn('NEW')
    await expect(updateTicketStatus(fresh.ticket.id, 'RESOLVED', 'skip ahead', fresh.staff)).rejects.toThrow(
      'Invalid ticket transition: NEW -> RESOLVED',
    )
    await expect(updateTicketStatus(fresh.ticket.id, 'ASSIGNED', undefined, fresh.staff)).rejects.toThrow(
      'Invalid ticket transition: NEW -> ASSIGNED',
    )
    expect((await statusOf(fresh.ticket.id)).assignedTo).toBeNull()

    const resolved = await ticketIn('RESOLVED')
    await expect(updateTicketStatus(resolved.ticket.id, 'RESOLVED', 'again', resolved.staff)).rejects.toThrow(
      'Invalid ticket transition: RESOLVED -> RESOLVED',
    )

    const closed = await ticketIn('CLOSED')
    await expect(updateTicketStatus(closed.ticket.id, 'NEW', undefined, closed.staff)).rejects.toThrow('Invalid ticket transition')
    await expect(updateTicketStatus(closed.ticket.id, 'IN_PROGRESS', undefined, closed.staff)).rejects.toThrow(
      'Invalid ticket transition',
    )
  })

  it('staff can reopen a resolved ticket; the stale note is cleared', async () => {
    const { ticket, staff } = await ticketIn('RESOLVED')
    const reopened = await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, staff)
    expect(reopened).toMatchObject({ status: 'IN_PROGRESS', resolutionNotes: null })
  })

  it('assigns an unowned ticket to whoever moves it', async () => {
    const { ticket, staff } = await ticketIn('RESOLVED')
    await db.update(supportTickets).set({ assignedTo: null }).where(eq(supportTickets.id, ticket.id))
    const reopened = await updateTicketStatus(ticket.id, 'IN_PROGRESS', undefined, staff)
    expect(reopened.assignedTo).toBe(staff.userId)
  })

  it('is staff-only and 404s an unknown ticket', async () => {
    const { ticket, requester, staff } = await ticketIn('IN_PROGRESS')
    await expect(updateTicketStatus(ticket.id, 'RESOLVED', 'x', requester)).rejects.toThrow('Forbidden')
    await expect(updateTicketStatus(crypto.randomUUID(), 'WAITING', undefined, staff)).rejects.toThrow('Ticket not found')
  })
})

describe('listTickets (admin overview count)', () => {
  it('filters by status and is staff-only', async () => {
    const staff = await makeUser('OPERATIONS')
    const results = await listTickets({ status: 'NEW' }, staff)
    expect(results.every((t) => t.status === 'NEW')).toBe(true)
    await expect(listTickets({}, await makeUser('STUDENT'))).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
