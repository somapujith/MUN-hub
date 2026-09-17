import type { Context, MiddlewareHandler } from 'hono'
import { consumeRateLimit, getClientIp, positiveIntEnv, type LimiterSpec } from '../lib/rate-limit-store'
import type { AppVariables } from '../src/types'

/**
 * Every limit this API enforces. `binding` names a Workers Rate Limiting
 * binding that server/wrangler.jsonc must declare with the same `limit` and
 * `period` (server/middleware/rate-limit.test.ts checks they agree). Without
 * the binding — local Node dev, tests — the same limits run in memory; see
 * server/lib/rate-limit-store.ts.
 */
export const LIMITERS = {
  /**
   * Per-IP cap on every /api/v1 request, including those that also match a
   * route rule below. The in-memory fallback can be replaced with
   * RATE_LIMIT_GLOBAL_PER_MINUTE (e.g. the E2E suite, where every request
   * comes from one address).
   */
  globalIp: {
    binding: 'RL_GLOBAL_IP',
    limit: 300,
    periodSeconds: 60,
    perIp: true,
    fallbackLimitOverride: () => positiveIntEnv('RATE_LIMIT_GLOBAL_PER_MINUTE'),
  },
  // Password sign-in: per IP (stops spraying one password across many
  // accounts) AND per account (stops guessing one account's password from
  // many addresses). Both apply to every attempt.
  loginIp: { binding: 'RL_LOGIN_IP', limit: 20, periodSeconds: 60, perIp: true },
  loginAccount: { binding: 'RL_LOGIN_ACCOUNT', limit: 5, periodSeconds: 60, perIp: false },
  // Delegate self-signup (optionally also behind Turnstile, server/lib/turnstile.ts).
  signupIp: { binding: 'RL_SIGNUP_IP', limit: 10, periodSeconds: 60, perIp: true },
  // Forgot-password emails: per IP and per address, for known and unknown
  // addresses alike. lib/actions/password-reset.ts additionally sends an
  // existing account at most one link a minute and three an hour.
  resetRequestIp: { binding: 'RL_RESET_REQUEST_IP', limit: 10, periodSeconds: 60, perIp: true },
  resetRequestEmail: { binding: 'RL_RESET_REQUEST_EMAIL', limit: 3, periodSeconds: 60, perIp: false },
  resetConfirmIp: { binding: 'RL_RESET_CONFIRM_IP', limit: 10, periodSeconds: 60, perIp: true },
  changePasswordUser: { binding: 'RL_CHANGE_PASSWORD_USER', limit: 5, periodSeconds: 60, perIp: false },
  // Staff TOTP sign-in challenge (lib/actions/staff-mfa.ts). The pending
  // token itself is single-use and already caps guesses per attempt
  // (MFA_MAX_ATTEMPTS in staff-mfa.ts); these bound spraying across many
  // different tokens from one IP, and hammering one token's endpoint fast.
  mfaVerifyIp: { binding: 'RL_MFA_VERIFY_IP', limit: 20, periodSeconds: 60, perIp: true },
  mfaVerifyToken: { binding: 'RL_MFA_VERIFY_TOKEN', limit: 10, periodSeconds: 60, perIp: false },
  // Self-service MFA management: disable, and regenerate recovery codes. Both
  // take a TOTP or recovery code to prove the caller is the account holder
  // rather than just whoever holds the session cookie, and neither keeps an
  // attempt counter of its own (unlike the sign-in challenge above) — so this
  // is what stops a stolen session cookie from being used to guess 6-digit
  // codes until MFA comes off the account. Keyed per user: more addresses
  // must not buy more guesses.
  mfaManageUser: { binding: 'RL_MFA_MANAGE_USER', limit: 5, periodSeconds: 60, perIp: false },
  // Uploaded files (logos, covers, PDFs) are fetched by the browser as <img>
  // sources — one marketplace page is two dozen of them. They get their own,
  // much higher per-IP budget INSTEAD of the global API one (`replacesGlobal`
  // below): a shared campus NAT address would otherwise spend the whole
  // 300/min API budget on cover images and 429 every API call behind it. Safe
  // to set high — the keys are unguessable, the bytes are immutable, and the
  // responses carry a one-year immutable cache.
  filesIp: { binding: 'RL_FILES_IP', limit: 600, periodSeconds: 60, perIp: true },
  // Organizer email-code sign-in. lib/actions/organizer-otp.ts also enforces a
  // per-address resend cooldown and hourly cap, and a per-code attempt limit.
  // The per-IP cap bounds how many different addresses one IP can send codes to.
  organizerCodeIp: { binding: 'RL_ORGANIZER_CODE_IP', limit: 30, periodSeconds: 60, perIp: true },
  organizerCodeIpEmail: { binding: 'RL_ORGANIZER_CODE_IP_EMAIL', limit: 3, periodSeconds: 60, perIp: false },
  organizerVerifyIpEmail: { binding: 'RL_ORGANIZER_VERIFY_IP_EMAIL', limit: 10, periodSeconds: 60, perIp: false },
  registrationsUser: { binding: 'RL_REGISTRATIONS_USER', limit: 10, periodSeconds: 60, perIp: false },
  // Support: new conversations/tickets, and messages in a conversation, per
  // signed-in user. The message limit leaves room for staff replying across
  // many tickets.
  supportTicketUser: { binding: 'RL_SUPPORT_TICKET_USER', limit: 10, periodSeconds: 60, perIp: false },
  supportMessageUser: { binding: 'RL_SUPPORT_MESSAGE_USER', limit: 30, periodSeconds: 60, perIp: false },
  // Account deletion re-checks the password, so this also bounds guessing it
  // with a stolen session.
  accountDeleteUser: { binding: 'RL_ACCOUNT_DELETE_USER', limit: 5, periodSeconds: 60, perIp: false },
  availabilityIp: { binding: 'RL_AVAILABILITY_IP', limit: 60, periodSeconds: 60, perIp: true },
  munsListIp: { binding: 'RL_MUNS_LIST_IP', limit: 120, periodSeconds: 60, perIp: true },
} satisfies Record<string, LimiterSpec>

type RequestFacts = {
  ip: string
  sessionUserId: string | null
  /** Lower-cased `email` from the JSON body, for rules that set `readsEmail`. */
  email?: string
  /** `pendingToken` from the JSON body, for rules that set `readsPendingToken`. */
  pendingToken?: string
}

type Check = { limiter: LimiterSpec; key: string }

type LimitRule = {
  method: string
  /** Exact path under /api/v1, or a pattern for paths with parameters. */
  path: string | RegExp
  /**
   * Match a string `path` as a prefix rather than exactly (e.g. `/files/` + a
   * storage key). Ignored when `path` is a RegExp.
   */
  prefix?: boolean
  /**
   * Count the request against this rule's own limits INSTEAD of the global
   * per-IP cap. Only for routes a browser fetches many of per page; every
   * other rule stacks on top of the global cap.
   */
  replacesGlobal?: boolean
  readsEmail?: boolean
  readsPendingToken?: boolean
  checks: (facts: RequestFacts) => Check[]
}

/**
 * A per-user limit for a signed-in-only route. An anonymous call isn't
 * counted here: the route answers 401 without doing any work, and the
 * global per-IP cap still applies.
 */
function perUser(limiter: LimiterSpec, sessionUserId: string | null): Check[] {
  return sessionUserId ? [{ limiter, key: `user:${sessionUserId}` }] : []
}

/** Both self-service MFA management routes share one per-user budget. */
function mfaManageChecks({ ip, sessionUserId }: RequestFacts): Check[] {
  return [{ limiter: LIMITERS.mfaManageUser, key: sessionUserId ? `user:${sessionUserId}` : `anon-ip:${ip}` }]
}

function matchesPath(rule: LimitRule, path: string): boolean {
  if (typeof rule.path !== 'string') return rule.path.test(path)
  return rule.prefix ? path.startsWith(rule.path) : rule.path === path
}

const RULES: LimitRule[] = [
  {
    method: 'POST',
    path: '/auth/session',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.loginIp, key: `ip:${ip}` },
      ...(email ? [{ limiter: LIMITERS.loginAccount, key: `email:${email}` }] : []),
    ],
  },
  {
    method: 'POST',
    path: '/auth/users',
    checks: ({ ip }) => [{ limiter: LIMITERS.signupIp, key: `ip:${ip}` }],
  },
  {
    method: 'POST',
    path: '/auth/session/password',
    checks: ({ ip, sessionUserId }) => [
      { limiter: LIMITERS.changePasswordUser, key: sessionUserId ? `user:${sessionUserId}` : `anon-ip:${ip}` },
    ],
  },
  {
    method: 'POST',
    path: '/password-reset/request',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.resetRequestIp, key: `ip:${ip}` },
      ...(email ? [{ limiter: LIMITERS.resetRequestEmail, key: `email:${email}` }] : []),
    ],
  },
  {
    method: 'POST',
    path: '/password-reset/confirm',
    checks: ({ ip }) => [{ limiter: LIMITERS.resetConfirmIp, key: `ip:${ip}` }],
  },
  {
    method: 'POST',
    path: '/auth/session/mfa',
    readsPendingToken: true,
    checks: ({ ip, pendingToken }) => [
      { limiter: LIMITERS.mfaVerifyIp, key: `ip:${ip}` },
      ...(pendingToken ? [{ limiter: LIMITERS.mfaVerifyToken, key: `token:${pendingToken}` }] : []),
    ],
  },
  {
    method: 'POST',
    path: '/auth/mfa/disable',
    checks: mfaManageChecks,
  },
  {
    method: 'POST',
    path: '/auth/mfa/recovery-codes',
    checks: mfaManageChecks,
  },
  {
    method: 'POST',
    path: '/auth/organizers/code',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.organizerCodeIp, key: `ip:${ip}` },
      { limiter: LIMITERS.organizerCodeIpEmail, key: `ip:${ip}${email ? `:email:${email}` : ''}` },
    ],
  },
  {
    method: 'POST',
    path: '/auth/organizers/session',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.organizerVerifyIpEmail, key: `ip:${ip}${email ? `:email:${email}` : ''}` },
    ],
  },
  {
    method: 'POST',
    path: '/registrations',
    checks: ({ sessionUserId }) => [
      { limiter: LIMITERS.registrationsUser, key: `session:${sessionUserId ?? 'anon'}` },
    ],
  },
  // Both routes open a new support ticket and share one budget.
  {
    method: 'POST',
    path: '/support/tickets',
    checks: ({ sessionUserId }) => perUser(LIMITERS.supportTicketUser, sessionUserId),
  },
  {
    method: 'POST',
    path: '/support/conversations',
    checks: ({ sessionUserId }) => perUser(LIMITERS.supportTicketUser, sessionUserId),
  },
  {
    method: 'POST',
    path: /^\/support\/conversations\/[^/]+\/messages$/,
    checks: ({ sessionUserId }) => perUser(LIMITERS.supportMessageUser, sessionUserId),
  },
  {
    method: 'POST',
    path: '/account/delete',
    checks: ({ sessionUserId }) => perUser(LIMITERS.accountDeleteUser, sessionUserId),
  },
  {
    method: 'GET',
    path: '/products/availability',
    checks: ({ ip }) => [{ limiter: LIMITERS.availabilityIp, key: `ip:${ip}` }],
  },
  {
    method: 'GET',
    path: '/muns',
    checks: ({ ip }) => [{ limiter: LIMITERS.munsListIp, key: `ip:${ip}` }],
  },
  // Uploaded-file reads (server/routes/files.ts): their own, much larger
  // per-IP budget instead of the global API one — see LIMITERS.filesIp.
  {
    method: 'GET',
    path: '/files/',
    prefix: true,
    replacesGlobal: true,
    checks: ({ ip }) => [{ limiter: LIMITERS.filesIp, key: `ip:${ip}` }],
  },
]

async function readBodyEmail(c: Context): Promise<string | undefined> {
  try {
    const body = (await c.req.raw.clone().json()) as { email?: unknown }
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() || undefined : undefined
  } catch {
    // body parse failure handled by route validation
    return undefined
  }
}

async function readBodyPendingToken(c: Context): Promise<string | undefined> {
  try {
    const body = (await c.req.raw.clone().json()) as { pendingToken?: unknown }
    return typeof body.pendingToken === 'string' ? body.pendingToken.trim() || undefined : undefined
  } catch {
    return undefined
  }
}

/**
 * Rate limits per spec Section 4.6, mounted on /api/v1 (webhook routes are
 * mounted outside it). Every request counts against the global per-IP cap;
 * a request matching a route rule additionally counts against each of that
 * rule's limits. The one exception is a rule marked `replacesGlobal` (image
 * and document reads), whose own per-IP limit stands in for the global cap
 * instead of stacking on it. The first exhausted limit answers 429 with
 * Retry-After.
 */
export const rateLimitMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const path = c.req.path.replace(/^\/api\/v1/, '') || '/'
  const method = c.req.method
  const matched = RULES.filter((rule) => rule.method === method && matchesPath(rule, path))

  const facts: RequestFacts = {
    ip: getClientIp(c),
    sessionUserId: c.get('session')?.userId ?? null,
  }
  if (matched.some((rule) => rule.readsEmail)) {
    facts.email = await readBodyEmail(c)
  }
  if (matched.some((rule) => rule.readsPendingToken)) {
    facts.pendingToken = await readBodyPendingToken(c)
  }

  const checks: Check[] = [
    ...(matched.some((rule) => rule.replacesGlobal) ? [] : [{ limiter: LIMITERS.globalIp, key: `ip:${facts.ip}` }]),
    ...matched.flatMap((rule) => rule.checks(facts)),
  ]

  const env: unknown = c.env
  for (const { limiter, key } of checks) {
    const result = await consumeRateLimit(env, limiter, key)
    if (!result.allowed) {
      c.header('Retry-After', String(Math.max(1, result.retryAfterSec)))
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } }, 429)
    }
  }

  await next()
}
