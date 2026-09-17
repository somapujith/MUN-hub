import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  assignTicket,
  createTicket,
  getAdminUnreadConversationCount,
  getConversation,
  listMyConversations,
  listTicketsWithRequester,
  markConversationRead,
  sendMessage,
  startConversation,
  getUnreadConversationCount,
  updateTicketStatus,
} from '@/lib/actions/support'
import {
  supportCategoryEnum,
  supportPriorityEnum,
  supportStatusEnum,
} from '@/lib/db/schema-enums'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

const createTicketBodySchema = z
  .object({
    category: z.enum(supportCategoryEnum.enumValues),
    priority: z.enum(supportPriorityEnum.enumValues).optional(),
    subject: z.string().min(1),
    description: z.string().min(1),
    relatedRegistrationId: z.string().uuid().optional(),
    relatedMunId: z.string().uuid().optional(),
  })
  .strict()

const listTicketsQuerySchema = z
  .object({
    status: z.enum(supportStatusEnum.enumValues).optional(),
  })
  .strict()

const updateTicketStatusBodySchema = z
  .object({
    status: z.enum(supportStatusEnum.enumValues),
    resolutionNotes: z.string().optional(),
  })
  .strict()

const startConversationBodySchema = z
  .object({
    body: z.string().min(1),
    category: z.enum(supportCategoryEnum.enumValues).optional(),
  })
  .strict()

const sendMessageBodySchema = z.object({ body: z.string().min(1) }).strict()

export const supportRoutes = new Hono<{ Variables: AppVariables }>()

supportRoutes.post(
  '/support/tickets',
  requireAuth,
  zValidator('json', createTicketBodySchema),
  async (c) => {
    const ticket = await createTicket(c.req.valid('json'), c.get('session'))
    return c.json(ticket, 201)
  },
)

// ---------------------------------------------------------------------------
// Chat thread (support widget) — same `lib/actions/support` chat surface the
// Next.js app's `app/support/chat-actions.ts` wraps, exposed here as REST so
// the Vite SPA (`/web`) can drive the identical floating widget without any
// Next.js dependency. Actor is always `c.get('session')`; owner-or-admin
// authorization is enforced inside the lib functions themselves, so both the
// student/organizer widget AND the admin reply UI call these same routes.
//
// Static paths (`/unread-count`, no `/:ticketId`) are registered before the
// `/:ticketId` routes below so they can never be shadowed by the param
// route, even though Hono's router already prioritizes static segments.
// ---------------------------------------------------------------------------

supportRoutes.get('/support/conversations/unread-count', requireAuth, async (c) => {
  const count = await getUnreadConversationCount(c.get('session'))
  return c.json({ count })
})

supportRoutes.get('/admin/support/unread-count', requireAuth, requireRole([...ADMIN_ROLES]), async (c) => {
  const count = await getAdminUnreadConversationCount(c.get('session'))
  return c.json({ count })
})

supportRoutes.get('/support/conversations', requireAuth, async (c) => {
  const tickets = await listMyConversations(c.get('session'))
  return c.json(tickets)
})

supportRoutes.post(
  '/support/conversations',
  requireAuth,
  zValidator('json', startConversationBodySchema),
  async (c) => {
    const { body, category } = c.req.valid('json')
    const result = await startConversation({ body, category }, c.get('session'))
    return c.json(result, 201)
  },
)

supportRoutes.get('/support/conversations/:ticketId', requireAuth, async (c) => {
  const result = await getConversation(c.req.param('ticketId'), c.get('session'))
  return c.json(result)
})

supportRoutes.post(
  '/support/conversations/:ticketId/messages',
  requireAuth,
  zValidator('json', sendMessageBodySchema),
  async (c) => {
    const message = await sendMessage(c.req.param('ticketId'), c.req.valid('json').body, c.get('session'))
    return c.json(message, 201)
  },
)

supportRoutes.post('/support/conversations/:ticketId/read', requireAuth, async (c) => {
  await markConversationRead(c.req.param('ticketId'), c.get('session'))
  return c.json({ ok: true })
})

supportRoutes.get(
  '/admin/support/tickets',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const filters = listTicketsQuerySchema.parse(c.req.query())
    const tickets = await listTicketsWithRequester(filters, c.get('session'))
    return c.json(tickets)
  },
)

supportRoutes.post(
  '/admin/support/tickets/:ticketId/assign',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const ticket = await assignTicket(c.req.param('ticketId'), c.get('session'))
    return c.json(ticket)
  },
)

supportRoutes.patch(
  '/admin/support/tickets/:ticketId',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  zValidator('json', updateTicketStatusBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const ticket = await updateTicketStatus(
      c.req.param('ticketId'),
      body.status,
      body.resolutionNotes,
      c.get('session'),
    )
    return c.json(ticket)
  },
)
