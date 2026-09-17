import { Hono } from 'hono'
import { z } from 'zod'
import {
  createMunFaq,
  deleteMunFaq,
  FAQ_ANSWER_MAX_LENGTH,
  FAQ_QUESTION_MAX_LENGTH,
  listMunFaqsForOrganizer,
  listPublicMunFaqs,
  updateMunFaq,
} from '@/lib/actions/mun-faq'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

const questionSchema = z.string().trim().min(1).max(FAQ_QUESTION_MAX_LENGTH)
const answerSchema = z.string().trim().min(1).max(FAQ_ANSWER_MAX_LENGTH)
const displayOrderSchema = z.number().int().nonnegative()

const createFaqBodySchema = z
  .object({
    question: questionSchema,
    answer: answerSchema,
    displayOrder: displayOrderSchema.optional(),
  })
  .strict()

const updateFaqBodySchema = z
  .object({
    question: questionSchema.optional(),
    answer: answerSchema.optional(),
    displayOrder: displayOrderSchema.optional(),
  })
  .strict()

export const munFaqRoutes = new Hono<{ Variables: AppVariables }>()

// Public: published (and later) muns only — any other mun answers 404.
munFaqRoutes.get('/muns/:munId/faqs', async (c) => {
  const faqs = await listPublicMunFaqs(c.req.param('munId'))
  return c.json(faqs)
})

// Organizer read, in every lifecycle state (for the editor).
munFaqRoutes.get('/muns/:munId/faqs/manage', requireAuth, async (c) => {
  const faqs = await listMunFaqsForOrganizer(c.req.param('munId'), c.get('session'))
  return c.json(faqs)
})

munFaqRoutes.post('/muns/:munId/faqs', requireAuth, zValidator('json', createFaqBodySchema), async (c) => {
  const faq = await createMunFaq(c.req.param('munId'), c.req.valid('json'), c.get('session'))
  return c.json(faq, 201)
})

munFaqRoutes.patch('/faqs/:faqId', requireAuth, zValidator('json', updateFaqBodySchema), async (c) => {
  const faq = await updateMunFaq(c.req.param('faqId'), c.req.valid('json'), c.get('session'))
  return c.json(faq)
})

munFaqRoutes.delete('/faqs/:faqId', requireAuth, async (c) => {
  await deleteMunFaq(c.req.param('faqId'), c.get('session'))
  return c.body(null, 204)
})
