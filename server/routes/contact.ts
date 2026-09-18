import { Hono } from 'hono'
import { z } from 'zod'
import { submitContactForm } from '@/lib/actions/contact-form'
import { REQUESTER_CATEGORIES, SUPPORT_LIMITS } from '@/lib/actions/support'
import { zValidator } from '../lib/zod-validator'
import type { AppVariables } from '../src/types'

const requesterCategory = z
  .enum(REQUESTER_CATEGORIES as [string, ...string[]])
  .transform((value) => value as (typeof REQUESTER_CATEGORIES)[number])

const contactFormBodySchema = z
  .object({
    category: requesterCategory,
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().min(1).max(254).email(),
    phone: z.string().trim().min(1).max(20),
    message: z.string().trim().max(SUPPORT_LIMITS.body).optional(),
    // Hidden field real visitors never fill in. A bot that autofills every
    // input trips it; a human never sees it. No CAPTCHA, no external keys —
    // just a silent no-op instead of a rejection, so a bot gets no signal
    // that anything was different about this submission.
    website: z.string().max(200).optional(),
  })
  .strict()

export const contactRoutes = new Hono<{ Variables: AppVariables }>()

// Public "Contact us" form — deliberately unauthenticated, matching
// lib/actions/contact-form.ts's doc comment on why it exists alongside the
// sign-in-only support desk in lib/actions/support.ts.
contactRoutes.post('/contact', zValidator('json', contactFormBodySchema), async (c) => {
  const body = c.req.valid('json')

  if (body.website) {
    // Honeypot tripped — accept and silently drop, same response shape as a
    // real submission either way.
    return c.body(null, 204)
  }

  await submitContactForm({
    category: body.category,
    name: body.name,
    email: body.email,
    phone: body.phone,
    message: body.message,
  })

  return c.body(null, 204)
})
