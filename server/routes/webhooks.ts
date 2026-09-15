import { Hono } from 'hono'
import type { AppVariables } from '../src/types'

/**
 * Webhook routes — mounted OUTSIDE /api/v1 and OUTSIDE CSRF middleware.
 * Sibling agents port app/api/webhooks/payments/route.ts here.
 */
export const webhooks = new Hono<{ Variables: AppVariables }>()

webhooks.get('/health', (c) =>
  c.json({ ok: true, scope: 'webhooks', requestId: c.get('requestId') }),
)
