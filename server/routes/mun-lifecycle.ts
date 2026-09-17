import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  CANCEL_REASON_MAX_LENGTH,
  LIFECYCLE_ACTIONS,
  LifecycleActionError,
  getLifecycleOverview,
  runLifecycleAction,
} from '@/lib/lifecycle/registration-lifecycle'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

// Registration & conference lifecycle controls (lib/lifecycle/registration-lifecycle.ts).
//
// Contract (the admin console codes its client against this exactly):
//   POST /api/v1/muns/:munId/lifecycle/:action
//     action ∈ open-registration | close-registration | start-conference |
//              complete | archive | cancel
//     body   {reason?: string}   (reason required for cancel; body optional otherwise)
//     200    {munId, status}
//     400 VALIDATION_FAILED (unknown action, bad body, missing reason)
//     401/403/404, 409 CONFLICT_STATE (wrong status or failed precondition —
//     `message` says which, written for the organizer)
//   GET /api/v1/muns/:munId/lifecycle — current status, the dates driving it,
//     and the caller's next actions (organizer settings page).

const actionSchema = z.enum(LIFECYCLE_ACTIONS)

const bodySchema = z
  .object({
    reason: z.string().max(CANCEL_REASON_MAX_LENGTH).nullable().optional(),
  })
  .strict()

type AppContext = Context<{ Variables: AppVariables }>

function lifecycleErrorResponse(c: AppContext, error: LifecycleActionError) {
  const code = error.status === 409 ? 'CONFLICT_STATE' : 'VALIDATION_FAILED'
  return c.json({ error: { code, message: error.message } }, error.status)
}

// The body is optional for every action but cancel, so an empty body (or a
// request without a JSON content type) reads as `{}` instead of failing the
// way the stock json validator would.
async function readBody(c: AppContext): Promise<unknown> {
  const raw = await c.req.text()
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export const munLifecycleRoutes = new Hono<{ Variables: AppVariables }>()
  .get('/muns/:munId/lifecycle', requireAuth, async (c) => {
    const overview = await getLifecycleOverview(c.req.param('munId'), c.get('session'))
    c.header('Cache-Control', 'no-store')
    return c.json(overview, 200)
  })
  .post('/muns/:munId/lifecycle/:action', requireAuth, async (c) => {
    const munId = c.req.param('munId')
    const action = actionSchema.safeParse(c.req.param('action'))
    if (!action.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: `Unknown lifecycle action — expected one of: ${LIFECYCLE_ACTIONS.join(', ')}`,
          },
        },
        400,
      )
    }

    const rawBody = await readBody(c)
    if (rawBody === undefined) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Request body must be valid JSON' } }, 400)
    }
    // A ZodError here is mapped to 400 VALIDATION_FAILED by the shared handler.
    const body = bodySchema.parse(rawBody)

    try {
      const result = await runLifecycleAction(munId, action.data, { reason: body.reason }, c.get('session'))
      return c.json(result, 200)
    } catch (error) {
      if (error instanceof LifecycleActionError) return lifecycleErrorResponse(c, error)
      throw error
    }
  })
