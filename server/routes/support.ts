import { zValidator } from '../lib/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  REQUESTER_CATEGORIES,
  STAFF_ROLES,
  SUPPORT_LIMITS,
  assignTicket,
  createTicket,
  getAdminUnreadConversationCount,
  getConversation,
  getUnreadConversationCount,
  listMyConversations,
  listStaffTickets,
  markConversationRead,
  sendMessage,
  startConversation,
  updateTicketStatus,
} from '@/lib/actions/support'
import { supportCategoryEnum, supportPriorityEnum, supportStatusEnum } from '@/lib/db/schema-enums'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

// ---------------------------------------------------------------------------
// Support desk REST surface over lib/actions/support.ts. Actor identity is
// always c.get('session'); the lib functions enforce requester-or-staff
// access per ticket, and the /admin/* routes are staff-only up front.
//
// Every body/query schema is strict and bounded by SUPPORT_LIMITS. Text is
// trimmed before the length checks, matching what the lib stores.
// ---------------------------------------------------------------------------

const staffRoles = [...STAFF_ROLES]

const requesterCategory = z.enum(REQUESTER_CATEGORIES as [string, ...string[]]).transform(
  (value) => value as (typeof REQUESTER_CATEGORIES)[number],
)

const text = (max: number) => z.string().trim().min(1).max(max)

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(SUPPORT_LIMITS.pageSizeMax).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
}

const createTicketBodySchema = z
  .object({
    category: requesterCategory,
    priority: z.enum(supportPriorityEnum.enumValues).optional(),
    subject: text(SUPPORT_LIMITS.subject),
    description: text(SUPPORT_LIMITS.body),
    relatedRegistrationId: z.string().uuid().optional(),
    relatedMunId: z.string().uuid().optional(),
  })
  .strict()

const startConversationBodySchema = z
  .object({
    body: text(SUPPORT_LIMITS.body),
    category: requesterCategory.optional(),
    relatedMunId: z.string().uuid().optional(),
  })
  .strict()

const sendMessageBodySchema = z
  .object({
    body: text(SUPPORT_LIMITS.body),
    /** Staff only: what the ticket becomes after this reply (default WAITING). */
    nextStatus: z.enum(['WAITING', 'IN_PROGRESS']).optional(),
  })
  .strict()

const myConversationsQuerySchema = z.object(pageQuery).strict()

const staffTicketsQuerySchema = z
  .object({
    status: z.enum([...supportStatusEnum.enumValues, 'OPEN']).optional(),
    category: z.enum(supportCategoryEnum.enumValues).optional(),
    priority: z.enum(supportPriorityEnum.enumValues).optional(),
    assignee: z.enum(['me', 'unassigned']).optional(),
    q: z.string().trim().max(SUPPORT_LIMITS.search).optional(),
    ...pageQuery,
  })
  .strict()

// ASSIGNED is reached through /assign, NEW never again.
const updateTicketStatusBodySchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']),
    resolutionNotes: z.string().trim().max(SUPPORT_LIMITS.resolutionNotes).optional(),
  })
  .strict()

export const supportRoutes = new Hono<{ Variables: AppVariables }>()

// --- Requester (and staff) conversation routes -----------------------------

supportRoutes.post('/support/tickets', requireAuth, zValidator('json', createTicketBodySchema), async (c) => {
  const ticket = await createTicket(c.req.valid('json'), c.get('session'))
  return c.json(ticket, 201)
})

// Static paths before `/:ticketId` so the param route never shadows them.
supportRoutes.get('/support/conversations/unread-count', requireAuth, async (c) => {
  const count = await getUnreadConversationCount(c.get('session'))
  return c.json({ count })
})

supportRoutes.get(
  '/support/conversations',
  requireAuth,
  zValidator('query', myConversationsQuerySchema),
  async (c) => {
    const page = await listMyConversations(c.get('session'), c.req.valid('query'))
    return c.json(page)
  },
)

supportRoutes.post(
  '/support/conversations',
  requireAuth,
  zValidator('json', startConversationBodySchema),
  async (c) => {
    const result = await startConversation(c.req.valid('json'), c.get('session'))
    return c.json(result, 201)
  },
)

supportRoutes.get('/support/conversations/:ticketId', requireAuth, async (c) => {
  const conversation = await getConversation(c.req.param('ticketId'), c.get('session'))
  return c.json(conversation)
})

supportRoutes.post(
  '/support/conversations/:ticketId/messages',
  requireAuth,
  zValidator('json', sendMessageBodySchema),
  async (c) => {
    const { body, nextStatus } = c.req.valid('json')
    const result = await sendMessage(c.req.param('ticketId'), body, c.get('session'), { nextStatus })
    return c.json(result, 201)
  },
)

supportRoutes.post('/support/conversations/:ticketId/read', requireAuth, async (c) => {
  await markConversationRead(c.req.param('ticketId'), c.get('session'))
  return c.json({ ok: true })
})

// --- Staff queue ------------------------------------------------------------

supportRoutes.get('/admin/support/unread-count', requireAuth, requireRole(staffRoles), async (c) => {
  const count = await getAdminUnreadConversationCount(c.get('session'))
  return c.json({ count })
})

supportRoutes.get(
  '/admin/support/tickets',
  requireAuth,
  requireRole(staffRoles),
  zValidator('query', staffTicketsQuerySchema),
  async (c) => {
    const page = await listStaffTickets(c.req.valid('query'), c.get('session'))
    return c.json(page)
  },
)

supportRoutes.post('/admin/support/tickets/:ticketId/assign', requireAuth, requireRole(staffRoles), async (c) => {
  const ticket = await assignTicket(c.req.param('ticketId'), c.get('session'))
  return c.json(ticket)
})

supportRoutes.patch(
  '/admin/support/tickets/:ticketId',
  requireAuth,
  requireRole(staffRoles),
  zValidator('json', updateTicketStatusBodySchema),
  async (c) => {
    const { status, resolutionNotes } = c.req.valid('json')
    const ticket = await updateTicketStatus(c.req.param('ticketId'), status, resolutionNotes, c.get('session'))
    return c.json(ticket)
  },
)
