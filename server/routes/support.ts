import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { assignTicket, createTicket, listTickets, updateTicketStatus } from '@/lib/actions/support'
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

supportRoutes.get(
  '/admin/support/tickets',
  requireAuth,
  requireRole([...ADMIN_ROLES]),
  async (c) => {
    const filters = listTicketsQuerySchema.parse(c.req.query())
    const tickets = await listTickets(filters, c.get('session'))
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
