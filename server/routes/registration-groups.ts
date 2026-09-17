import { zValidator } from '../lib/zod-validator'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { assertEmailVerifiedIfRequired } from '@/lib/actions/email-verification'
import {
  GROUP_MAX_SIZE,
  GROUP_MIN_SIZE,
  REGISTRATION_ERRORS,
  REGISTRATION_ERROR_STATUS,
  initiateGroupRegistration,
} from '@/lib/actions/registration'
import {
  acceptGroupInvitation,
  cancelGroupInvitation,
  getGroupRoster,
  getInvitationPreview,
  inviteGroupMember,
  resendGroupInvitation,
} from '@/lib/actions/registration-group'
import { isProfileComplete } from '@/lib/actions/student-profile'
import { requireAuth } from '../middleware/require-auth'
import { resolveResetAppUrl } from './password-reset'
import type { AppVariables } from '../src/types'

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

const startGroupBodySchema = z
  .object({
    munId: z.string().uuid(),
    registrationProductId: z.string().uuid(),
    teamSize: z.number().int().min(GROUP_MIN_SIZE).max(GROUP_MAX_SIZE),
    formResponses: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const inviteBodySchema = z
  .object({
    email: z.string().trim().min(1).email(),
    invitedName: z.string().trim().max(200).optional(),
  })
  .strict()

const acceptBodySchema = z
  .object({
    formResponses: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

function registrationErrorResponse(c: Context<{ Variables: AppVariables }>, message: string) {
  const status = REGISTRATION_ERROR_STATUS[message] ?? 400
  const code =
    status === 503 ? 'PAYMENTS_UNAVAILABLE' : status === 409 ? 'CONFLICT_STATE' : 'VALIDATION_FAILED'
  return c.json({ error: { code, message } }, status)
}

function resolveAppUrl(c: Context<{ Variables: AppVariables }>): string {
  return resolveResetAppUrl(c.req.header('Origin'))
}

export const registrationGroupsRoutes = new Hono<{ Variables: AppVariables }>()

/**
 * Starts a group/delegation registration: the head delegate reserves and
 * pays for `teamSize` seats in one order. Same `Idempotency-Key` contract as
 * `POST /registrations` — a retry with the same key answers 200 with the
 * original group instead of reserving a second one.
 */
registrationGroupsRoutes.post(
  '/registrations/group',
  requireAuth,
  async (c, next) => {
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return c.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Idempotency-Key header is required' } },
        400,
      )
    }
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
          },
        },
        400,
      )
    }
    await next()
  },
  zValidator('json', startGroupBodySchema),
  async (c) => {
    const body = c.req.valid('json')
    const session = c.get('session')!
    const idempotencyKey = c.req.header('Idempotency-Key')!.trim()

    // Same gates as solo registration — the head delegate is a delegate too.
    if (!(await isProfileComplete(session.userId))) {
      return registrationErrorResponse(c, REGISTRATION_ERRORS.profileIncomplete)
    }
    await assertEmailVerifiedIfRequired(session.userId)

    try {
      const result = await initiateGroupRegistration(body, session, { idempotencyKey })
      return c.json(result, result.replayed ? 200 : 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (Object.hasOwn(REGISTRATION_ERROR_STATUS, message)) {
        return registrationErrorResponse(c, message)
      }
      throw error
    }
  },
)

/** The head delegate's (or staff's) full roster view: who's joined, who's pending, who's still an open seat. */
registrationGroupsRoutes.get('/registration-groups/:id', requireAuth, async (c) => {
  const roster = await getGroupRoster(c.req.param('id'), c.get('session'))
  return c.json(roster)
})

/** Invites one teammate into an open seat. Only legal once the group's own registration is paid (CONFIRMED). */
registrationGroupsRoutes.post(
  '/registration-groups/:id/invitations',
  requireAuth,
  zValidator('json', inviteBodySchema),
  async (c) => {
    const { email, invitedName } = c.req.valid('json')
    const invitation = await inviteGroupMember(
      c.req.param('id'),
      email,
      invitedName,
      resolveAppUrl(c),
      c.get('session'),
    )
    return c.json(invitation, 201)
  },
)

/** Rotates the invitation's link and re-sends it. 60-second cooldown per invitation. */
registrationGroupsRoutes.post('/registration-groups/invitations/:invitationId/resend', requireAuth, async (c) => {
  const invitation = await resendGroupInvitation(c.req.param('invitationId'), resolveAppUrl(c), c.get('session'))
  return c.json(invitation)
})

/** Cancels a still-pending invitation, freeing its seat for a fresh invite to a different address. */
registrationGroupsRoutes.post('/registration-groups/invitations/:invitationId/cancel', requireAuth, async (c) => {
  await cancelGroupInvitation(c.req.param('invitationId'), c.get('session'))
  return c.body(null, 204)
})

/**
 * Public, unauthenticated preview of an invitation — lets the accept page
 * show who invited whom to what before asking the visitor to sign in, same
 * "the token itself is the credential" stance as email-verification/
 * password-reset's own token routes.
 */
registrationGroupsRoutes.get('/group-invitations/:token', async (c) => {
  const preview = await getInvitationPreview(c.req.param('token'))
  return c.json(preview)
})

/**
 * Claims one team seat for the signed-in caller. No payment happens here —
 * the team's single payment already confirmed every seat; this only records
 * who's filling it and their registration-form answers.
 */
registrationGroupsRoutes.post(
  '/group-invitations/:token/accept',
  requireAuth,
  zValidator('json', acceptBodySchema),
  async (c) => {
    const { formResponses } = c.req.valid('json')
    const session = c.get('session')!

    if (!(await isProfileComplete(session.userId))) {
      return registrationErrorResponse(c, REGISTRATION_ERRORS.profileIncomplete)
    }
    await assertEmailVerifiedIfRequired(session.userId)

    const result = await acceptGroupInvitation(c.req.param('token'), formResponses, session)
    return c.json(result)
  },
)
