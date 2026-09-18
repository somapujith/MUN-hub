import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportMessages, supportTickets, users } from '@/lib/db/schema'
import { submitContactForm } from './contact-form'

vi.mock('./telegram', () => ({
  notifyStaffNewTicket: vi.fn().mockResolvedValue(undefined),
}))

async function makeAdmin(): Promise<{ id: string; role: 'SUPER_ADMIN' }> {
  const [user] = await db
    .insert(users)
    .values({
      name: 'Test Admin',
      email: `contact-form-admin-${crypto.randomUUID()}@test.dev`,
      role: 'SUPER_ADMIN',
    })
    .returning()
  return { id: user.id, role: 'SUPER_ADMIN' }
}

describe('submitContactForm', () => {
  it('files a ticket under an existing admin account with the visitor details in the body', async () => {
    // Doesn't assert *which* admin — the shared test DB can carry
    // ADMIN/SUPER_ADMIN rows left over from other test files, and
    // submitContactForm deterministically picks the oldest one, not
    // necessarily the one this test just inserted. What matters is that
    // whichever account it picked really is staff.
    await makeAdmin()

    const { ticketId } = await submitContactForm({
      category: 'MUN_INFO',
      name: 'Priya Sharma',
      email: 'PRIYA@Example.com ',
      phone: '+91 90000 00000',
      message: 'When does registration open for BITSMUN?',
    })

    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1)
    const [creator] = await db.select({ role: users.role }).from(users).where(eq(users.id, ticket.createdBy)).limit(1)
    expect(['ADMIN', 'SUPER_ADMIN']).toContain(creator.role)
    expect(ticket.category).toBe('MUN_INFO')
    expect(ticket.priority).toBe('NORMAL')
    expect(ticket.subject).toContain('Priya Sharma')
    expect(ticket.description).toContain('Name: Priya Sharma')
    // Normalized to lowercase and trimmed, same as every other email entry point.
    expect(ticket.description).toContain('Email: priya@example.com')
    expect(ticket.description).toContain('Phone: +91 90000 00000')
    expect(ticket.description).toContain('When does registration open for BITSMUN?')

    const [message] = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, ticketId)).limit(1)
    expect(message.senderId).toBe(ticket.createdBy)
    expect(message.body).toBe(ticket.description)
  })

  it('defaults the body to a placeholder when no message is given', async () => {
    await makeAdmin()

    const { ticketId } = await submitContactForm({
      category: 'GENERAL',
      name: 'No Message',
      email: 'no-message@example.com',
      phone: '9000000000',
    })

    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1)
    expect(ticket.description).toContain('(No message provided.)')
  })

  it('rejects a category outside the public allow-list', async () => {
    await makeAdmin()

    await expect(
      submitContactForm({
        category: 'REFUND' as never,
        name: 'Someone',
        email: 'someone@example.com',
        phone: '9000000000',
      }),
    ).rejects.toThrow('A supported category is required')
  })
})

afterAll(() => db.$client.end())
