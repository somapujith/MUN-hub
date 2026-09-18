import { asc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { supportMessages, supportTickets, users } from '@/lib/db/schema'
import { runInBackground } from '@/lib/background-tasks'
import { REQUESTER_CATEGORIES, SUPPORT_LIMITS, type RequesterCategory } from './support'
import { notifyStaffNewTicket } from './telegram'

// -----------------------------------------------------------------------------
// The public "Contact us" form — no sign-in, unlike every other entry point
// into the support desk (lib/actions/support.ts's `createTicket` and
// `startConversation` both require a session). `support_tickets.created_by`
// is a NOT NULL FK to `users`, so there is no anonymous-ticket concept in the
// schema to hook into.
//
// Rather than migrate that column to support a guest submitter (a real
// change to a live, actively-used table), a submission is filed as a ticket
// under a real ADMIN/SUPER_ADMIN account — whichever was created first — so
// it lands in the same staff queue as every other ticket and fires the same
// new-ticket alert. The visitor's own name/email/phone are folded into the
// ticket body rather than the `created_by` join, so the staff queue's
// "requester" column will show the admin account, not the visitor — the
// visitor's real contact details are in the opening message, which is what
// staff read when they open the ticket.
// -----------------------------------------------------------------------------

export interface ContactFormInput {
  category: RequesterCategory
  name: string
  email: string
  phone: string
  message?: string
}

/**
 * Submits the public contact form. Input is already validated/bounded at the
 * HTTP layer (server/routes/contact.ts's Zod schema) — this trusts it and
 * only re-checks the category against the same allow-list `createTicket`
 * uses, since it's cheap and this is a public, unauthenticated write path.
 */
export async function submitContactForm(input: ContactFormInput): Promise<{ ticketId: string }> {
  if (!(REQUESTER_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new Error('A supported category is required')
  }

  const [admin] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.role, ['SUPER_ADMIN', 'ADMIN']))
    .orderBy(asc(users.createdAt))
    .limit(1)
  if (!admin) throw new Error('No admin account is configured to receive this message')

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()
  const message = input.message?.trim() || '(No message provided.)'

  const subject = `Contact form (${input.category}) — ${name}`.slice(0, SUPPORT_LIMITS.subject)
  const body = [`Name: ${name}`, `Email: ${email}`, `Phone: ${phone}`, '', message]
    .join('\n')
    .slice(0, SUPPORT_LIMITS.body)

  const { ticket } = await db.transaction(async (tx) => {
    const now = new Date()
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        createdBy: admin.id,
        category: input.category,
        priority: 'NORMAL',
        subject,
        description: body,
        lastMessageAt: now,
        lastMessageSenderId: admin.id,
        requesterReadAt: now,
      })
      .returning()

    await tx
      .insert(supportMessages)
      .values({ ticketId: ticket.id, senderId: admin.id, senderRole: admin.role, body })

    return { ticket }
  })

  runInBackground('telegram new ticket notification (contact form)', () =>
    notifyStaffNewTicket({
      ticketId: ticket.id,
      subject: ticket.subject,
      requesterName: `${name} (via contact form)`,
    }),
  )

  return { ticketId: ticket.id }
}
