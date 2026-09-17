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
   * route rule below — except uploaded-file reads (`filesIp`). The in-memory
   * fallback can be replaced with
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
  // Self-service MFA disable / recovery-code regeneration. Each takes a fresh
  // TOTP (or recovery) code to prove the caller is the account holder and not
  // just someone holding the session cookie, and nothing else counts wrong
  // guesses there, so this per-account cap is what makes guessing the code
  // impractical. Both routes share one budget per user.
  mfaManageUser: { binding: 'RL_MFA_MANAGE_USER', limit: 5, periodSeconds: 60, perIp: false },
  // Organizer email-code sign-in. lib/actions/organizer-otp.ts also enforces a
  // per-address resend cooldown and hourly cap, and a per-code attempt limit.
  // The per-IP cap bounds how many different addresses one IP can send codes to.
  organizerCodeIp: { binding: 'RL_ORGANIZER_CODE_IP', limit: 30, periodSeconds: 60, perIp: true },
  organizerCodeIpEmail: { binding: 'RL_ORGANIZER_CODE_IP_EMAIL', limit: 3, periodSeconds: 60, perIp: false },
  organizerVerifyIpEmail: { binding: 'RL_ORGANIZER_VERIFY_IP_EMAIL', limit: 10, periodSeconds: 60, perIp: false },
  registrationsUser: { binding: 'RL_REGISTRATIONS_USER', limit: 10, periodSeconds: 60, perIp: false },
  availabilityIp: { binding: 'RL_AVAILABILITY_IP', limit: 60, periodSeconds: 60, perIp: true },
  munsListIp: { binding: 'RL_MUNS_LIST_IP', limit: 120, periodSeconds: 60, perIp: true },
  // Uploaded-file reads (GET /api/v1/files/*): counted here INSTEAD of the
  // global cap. One /muns page loads up to 24 cover images, so a school lab
  // behind one address would otherwise use up the global budget on images
  // alone and break its API calls too. The files are immutable and cached for
  // a year, so this only bounds hot-linking/scraping.
  filesIp: { binding: 'RL_FILES_IP', limit: 1200, periodSeconds: 60, perIp: true },
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
  methods: readonly string[]
  /** Exact path under /api/v1, or — ending in '/' — every path below it. */
  path: string
  readsEmail?: boolean
  readsPendingToken?: boolean
  /**
   * The rule's checks replace the global per-IP cap instead of adding to it.
   * Only for cheap, static reads that a single page loads many of.
   */
  replacesGlobal?: boolean
  checks: (facts: RequestFacts) => Check[]
}

function ruleMatches(rule: LimitRule, method: string, path: string): boolean {
  if (!rule.methods.includes(method)) return false
  return rule.path.endsWith('/') ? path.startsWith(rule.path) && path.length > rule.path.length : path === rule.path
}

/** Keys a signed-in user's own budget; a signed-out caller (rejected later by requireAuth) is keyed by IP. */
function userKey({ ip, sessionUserId }: RequestFacts): string {
  return sessionUserId ? `user:${sessionUserId}` : `anon-ip:${ip}`
}

const RULES: LimitRule[] = [
  {
    methods: ['POST'],
    path: '/auth/session',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.loginIp, key: `ip:${ip}` },
      ...(email ? [{ limiter: LIMITERS.loginAccount, key: `email:${email}` }] : []),
    ],
  },
  {
    methods: ['POST'],
    path: '/auth/users',
    checks: ({ ip }) => [{ limiter: LIMITERS.signupIp, key: `ip:${ip}` }],
  },
  {
    methods: ['POST'],
    path: '/auth/session/password',
    checks: (facts) => [{ limiter: LIMITERS.changePasswordUser, key: userKey(facts) }],
  },
  {
    methods: ['POST'],
    path: '/password-reset/request',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.resetRequestIp, key: `ip:${ip}` },
      ...(email ? [{ limiter: LIMITERS.resetRequestEmail, key: `email:${email}` }] : []),
    ],
  },
  {
    methods: ['POST'],
    path: '/password-reset/confirm',
    checks: ({ ip }) => [{ limiter: LIMITERS.resetConfirmIp, key: `ip:${ip}` }],
  },
  {
    methods: ['POST'],
    path: '/auth/session/mfa',
    readsPendingToken: true,
    checks: ({ ip, pendingToken }) => [
      { limiter: LIMITERS.mfaVerifyIp, key: `ip:${ip}` },
      ...(pendingToken ? [{ limiter: LIMITERS.mfaVerifyToken, key: `token:${pendingToken}` }] : []),
    ],
  },
  // Same key for both routes, so alternating between them doesn't double the budget.
  {
    methods: ['POST'],
    path: '/auth/mfa/disable',
    checks: (facts) => [{ limiter: LIMITERS.mfaManageUser, key: userKey(facts) }],
  },
  {
    methods: ['POST'],
    path: '/auth/mfa/recovery-codes',
    checks: (facts) => [{ limiter: LIMITERS.mfaManageUser, key: userKey(facts) }],
  },
  {
    methods: ['POST'],
    path: '/auth/organizers/code',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.organizerCodeIp, key: `ip:${ip}` },
      { limiter: LIMITERS.organizerCodeIpEmail, key: `ip:${ip}${email ? `:email:${email}` : ''}` },
    ],
  },
  {
    methods: ['POST'],
    path: '/auth/organizers/session',
    readsEmail: true,
    checks: ({ ip, email }) => [
      { limiter: LIMITERS.organizerVerifyIpEmail, key: `ip:${ip}${email ? `:email:${email}` : ''}` },
    ],
  },
  {
    methods: ['POST'],
    path: '/registrations',
    checks: ({ sessionUserId }) => [
      { limiter: LIMITERS.registrationsUser, key: `session:${sessionUserId ?? 'anon'}` },
    ],
  },
  {
    methods: ['GET'],
    path: '/products/availability',
    checks: ({ ip }) => [{ limiter: LIMITERS.availabilityIp, key: `ip:${ip}` }],
  },
  {
    methods: ['GET'],
    path: '/muns',
    checks: ({ ip }) => [{ limiter: LIMITERS.munsListIp, key: `ip:${ip}` }],
  },
  {
    // server/routes/files.ts is the only handler under /files/. Hono answers
    // HEAD with the GET handler but keeps HEAD as the request method.
    methods: ['GET', 'HEAD'],
    path: '/files/',
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
 * rule's limits. The one exception is a rule marked `replacesGlobal`
 * (uploaded-file reads), whose own limit is counted instead of the global
 * cap. The first exhausted limit answers 429 with Retry-After.
 */
export const rateLimitMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const path = c.req.path.replace(/^\/api\/v1/, '') || '/'
  const method = c.req.method
  const matched = RULES.filter((rule) => ruleMatches(rule, method, path))

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
