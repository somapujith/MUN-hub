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
  it('sets assignedTo and status ASSIGNED, logs TICKET_ASSIGNED', async () => {
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
    const assigned = await assignTicket(ticket.id, admin.id)
    expect(assigned.status).toBe('ASSIGNED')
    expect(assigned.assignedTo).toBe(admin.id)

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(log.action).toBe('TICKET_ASSIGNED')
  })

  it('throws Forbidden for a student trying to assign a ticket', async () => {
    const [student] = await db
      .insert(users)
      .values({ name: 'S2b', email: `s2b-${crypto.randomUUID()}@test.dev`, role: 'STUDENT' })
      .returning()
    vi.mocked(getSession).mockResolvedValue({ userId: student.id, role: 'STUDENT' })
    const ticket = await createTicket({ category: 'ACCOUNT', subject: 'x', description: 'x' })

    await expect(assignTicket(ticket.id, student.id)).rejects.toThrow('Forbidden')
  })
})

describe('updateTicketStatus', () => {
  it('transitions to RESOLVED with resolution notes, logs TICKET_RESOLVED', async () => {
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
    const resolved = await updateTicketStatus(ticket.id, 'RESOLVED', 'fixed it')
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.resolutionNotes).toBe('fixed it')

    const [log] = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(log.action).toBe('TICKET_RESOLVED')
    expect(log.reason).toBe('fixed it')
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
    const inProgress = await updateTicketStatus(ticket.id, 'IN_PROGRESS')
    expect(inProgress.status).toBe('IN_PROGRESS')

    const logs = await db.select().from(adminActions).where(eq(adminActions.targetId, ticket.id))
    expect(logs).toHaveLength(0)
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
