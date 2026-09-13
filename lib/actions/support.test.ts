import { describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { users, supportTickets, adminActions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTicket, listTickets, assignTicket, updateTicketStatus } from './support'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
import { getSession } from '@/lib/auth/session'

describe('createTicket', () => {
  it('creates a NEW ticket with default NORMAL priority', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S', email: `s-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })

    const ticket = await createTicket({ category: 'PAYMENT', subject: 'Payment failed', description: 'x' })
    expect(ticket.status).toBe('NEW')
    expect(ticket.priority).toBe('NORMAL')
    expect(ticket.createdBy).toBe(student.id)
  })

  it('throws Forbidden with no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(createTicket({ category: 'PAYMENT', subject: 'x', description: 'x' })).rejects.toThrow('Forbidden')
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    const assigned = await assignTicket(ticket.id)
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

    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticketOne = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' })
    const ticketTwo = await createTicket({ category: 'ACCOUNT', subject: 'y', description: 'y' })

    vi.mocked(getSession).mockResolvedValue({ userId: adminOne.id, role: 'ADMIN' })
    const assignedOne = await assignTicket(ticketOne.id)
    expect(assignedOne.assignedTo).toBe(adminOne.id)

    vi.mocked(getSession).mockResolvedValue({ userId: adminTwo.id, role: 'OPERATIONS' })
    const assignedTwo = await assignTicket(ticketTwo.id)
    expect(assignedTwo.assignedTo).toBe(adminTwo.id)
    expect(assignedTwo.assignedTo).not.toBe(adminOne.id)
  })

  it('throws Forbidden for a student trying to assign a ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2b', email: `s2b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' })

    await expect(assignTicket(ticket.id)).rejects.toThrow('Forbidden')
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await assignTicket(ticket.id)
    await updateTicketStatus(ticket.id, 'IN_PROGRESS')
    const resolved = await updateTicketStatus(ticket.id, 'RESOLVED', 'fixed it')
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await assignTicket(ticket.id)
    const inProgress = await updateTicketStatus(ticket.id, 'IN_PROGRESS')
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    await expect(updateTicketStatus(ticket.id, 'RESOLVED')).rejects.toThrow('Forbidden')
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await assignTicket(ticket.id)
    const waiting = await updateTicketStatus(ticket.id, 'WAITING')
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await expect(updateTicketStatus(ticket.id, 'RESOLVED', 'skip ahead')).rejects.toThrow(
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await assignTicket(ticket.id)
    await updateTicketStatus(ticket.id, 'IN_PROGRESS')
    await updateTicketStatus(ticket.id, 'RESOLVED', 'done')

    await expect(updateTicketStatus(ticket.id, 'RESOLVED', 'done again')).rejects.toThrow(
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
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'TECHNICAL', subject: 'x', description: 'x' })

    vi.mocked(getSession).mockResolvedValue({ userId: admin.id, role: 'ADMIN' })
    await assignTicket(ticket.id)
    await updateTicketStatus(ticket.id, 'IN_PROGRESS')
    await updateTicketStatus(ticket.id, 'RESOLVED', 'done')
    await updateTicketStatus(ticket.id, 'CLOSED')

    await expect(updateTicketStatus(ticket.id, 'NEW')).rejects.toThrow('Invalid ticket transition')
  })
})

describe('listTickets', () => {
  it('filters by status', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-x', role: 'OPERATIONS' })
    const results = await listTickets({ status: 'NEW' })
    expect(Array.isArray(results)).toBe(true)
    expect(results.every((t) => t.status === 'NEW')).toBe(true)
  })

  it('returns all tickets with no filter', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'admin-x', role: 'OPERATIONS' })
    const results = await listTickets()
    expect(Array.isArray(results)).toBe(true)
  })

  it('throws Forbidden for a student', async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: 'student-x', role: 'STUDENT' })
    await expect(listTickets()).rejects.toThrow('Forbidden')
  })
})
