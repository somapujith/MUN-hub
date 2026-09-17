import type { Context } from 'hono'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { getClientIp } from './rate-limit-store'

/**
 * Cloudflare Turnstile (bot check) for abuse-prone public forms: delegate
 * signup and organizer sign-in code requests.
 *
 * Opt-in: active only when the TURNSTILE_SECRET_KEY secret is set. Unset —
 * local dev, tests, and any deployment that hasn't configured it — the check
 * is skipped entirely and the forms work without a token. The SPA renders
 * the widget only when VITE_TURNSTILE_SITE_KEY is set at build time, so the
 * two must be configured together (a secret without the site key would
 * reject every signup).
 */

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** Longest token Cloudflare issues. */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048
const SITEVERIFY_TIMEOUT_MS = 5000

/** The widget `action` for each protected form; siteverify must echo the same one. */
export const TURNSTILE_ACTIONS = {
  delegateSignup: 'delegate-signup',
  organizerCode: 'organizer-code',
} as const

export const TURNSTILE_MESSAGES = {
  missing: 'Complete the verification check and try again',
  failed: 'Verification check failed. Please try again',
  unavailable: 'Verification is unavailable right now. Try again in a moment',
} as const

type SiteverifyResponse = {
  success?: boolean
  action?: string
  'error-codes'?: string[]
}

export type TurnstileOutcome = 'passed' | 'missing' | 'failed' | 'unavailable'

/** Server-side siteverify for one token. Never throws. */
export async function verifyTurnstileToken(input: {
  secret: string
  token: string | undefined
  expectedAction: string
  remoteIp?: string
}): Promise<TurnstileOutcome> {
  if (!input.token) return 'missing'

  let outcome: SiteverifyResponse
  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: input.secret,
        response: input.token,
        ...(input.remoteIp ? { remoteip: input.remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`siteverify answered HTTP ${response.status}`)
    outcome = (await response.json()) as SiteverifyResponse
  } catch (error) {
    console.error('[turnstile] siteverify request failed', { error })
    return 'unavailable'
  }

  // A token minted for a different form doesn't count for this one.
  if (outcome.success !== true || (outcome.action !== undefined && outcome.action !== input.expectedAction)) {
    console.warn('[turnstile] token rejected', { errorCodes: outcome['error-codes'], action: outcome.action })
    return 'failed'
  }
  return 'passed'
}

/**
 * Route guard: returns an error response to send when the request's
 * Turnstile token doesn't pass, or null to carry on (including whenever
 * Turnstile isn't configured). Answers 400 VALIDATION_FAILED for a
 * missing/rejected token and 503 UNAVAILABLE when siteverify can't be
 * reached — a configured check fails closed.
 */
export async function turnstileRejection(
  c: Context,
  token: string | undefined,
  expectedAction: string,
): Promise<Response | null> {
  const secret = getRuntimeEnv('TURNSTILE_SECRET_KEY')
  if (!secret) return null

  const ip = getClientIp(c)
  const outcome = await verifyTurnstileToken({
    secret,
    token,
    expectedAction,
    remoteIp: ip === 'unknown' ? undefined : ip,
  })

  switch (outcome) {
    case 'passed':
      return null
    case 'unavailable':
      return c.json({ error: { code: 'UNAVAILABLE', message: TURNSTILE_MESSAGES.unavailable } }, 503)
    case 'missing':
      return c.json({ error: { code: 'VALIDATION_FAILED', message: TURNSTILE_MESSAGES.missing } }, 400)
    case 'failed':
      return c.json({ error: { code: 'VALIDATION_FAILED', message: TURNSTILE_MESSAGES.failed } }, 400)
  }
}
