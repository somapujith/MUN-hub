import type { Context } from 'hono'
import { getRuntimeEnv } from '@/lib/runtime-env'

/**
 * Error reporting for the API Worker without an SDK dependency.
 *
 * Every report is written to the log as one structured `console.error` line,
 * which Workers Logs indexes. When the `SENTRY_DSN` secret is set, the error
 * is also sent to Sentry as a single envelope over `fetch` (Sentry's
 * envelope endpoint, no @sentry/* package). Reporting never throws and never
 * rejects: a broken tracker must not turn into a second failure.
 *
 * Context values end up in log lines and Sentry tags. Pass identifiers only
 * (request id, route path without its query string, job name). Never pass
 * request bodies, query strings (reset tokens live there), emails or names.
 *
 * Env (read per call via getRuntimeEnv, never cached):
 * - SENTRY_DSN: enables Sentry delivery; unset means log only
 * - SENTRY_ENVIRONMENT: defaults to "production"
 * - SENTRY_RELEASE: optional, e.g. the deployed git sha
 */

export type ErrorReportContext = Record<string, string | number | boolean | null | undefined>

const SENTRY_TIMEOUT_MS = 3000
const MAX_TAG_LENGTH = 200
const CLIENT_NAME = 'munhub-report-error/1.0'

interface SentryTarget {
  dsn: string
  envelopeUrl: string
  publicKey: string
}

interface StackFrame {
  function?: string
  filename: string
  lineno?: number
  colno?: number
}

/**
 * `https://<key>@<host>[/<path>]/<projectId>` → the project's envelope
 * endpoint, or null when the DSN is malformed.
 */
export function parseSentryDsn(dsn: string): SentryTarget | null {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    return null
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const projectId = segments.pop()
  if (!url.username || !projectId || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null
  const prefix = segments.length ? `/${segments.join('/')}` : ''
  return {
    dsn,
    publicKey: decodeURIComponent(url.username),
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  }
}

/** Parses V8 stack lines ("    at fn (file:1:2)") into Sentry frames, oldest call first. */
function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return []
  const frames: StackFrame[] = []
  for (const line of stack.split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line)
    if (!match) continue
    frames.push({
      function: match[1],
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    })
  }
  return frames.reverse()
}

interface DescribedError {
  type: string
  message: string
  stack?: string
  cause?: string
}

function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : error.cause === undefined ? undefined : String(error.cause)
    return { type: error.name || 'Error', message: error.message, stack: error.stack, cause }
  }
  return { type: 'NonError', message: String(error) }
}

function buildEnvelope(target: SentryTarget, error: DescribedError, context: ErrorReportContext): string {
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const now = new Date()
  const tags: Record<string, string> = {}
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null) tags[key] = String(value).slice(0, MAX_TAG_LENGTH)
  }
  const frames = parseStack(error.stack)
  const release = getRuntimeEnv('SENTRY_RELEASE')

  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'munhub-api',
    server_name: 'munhub-api',
    environment: getRuntimeEnv('SENTRY_ENVIRONMENT') || 'production',
    ...(release ? { release } : {}),
    exception: {
      values: [
        {
          type: error.type,
          value: error.message,
          ...(frames.length ? { stacktrace: { frames } } : {}),
        },
      ],
    },
    tags,
    extra: { ...context, ...(error.cause ? { cause: error.cause } : {}) },
  }

  return [
    JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn: target.dsn }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(event),
  ].join('\n')
}

/** Logs `error` and, when SENTRY_DSN is set, sends it to Sentry. Always resolves. */
export async function reportError(error: unknown, context: ErrorReportContext = {}): Promise<void> {
  try {
    const described = describeError(error)
    console.error({
      ...context,
      level: 'error',
      event: 'error.reported',
      errorType: described.type,
      error: described.message,
      stack: described.stack,
      cause: described.cause,
    })

    const dsn = getRuntimeEnv('SENTRY_DSN')?.trim()
    if (!dsn) return

    const target = parseSentryDsn(dsn)
    if (!target) {
      console.warn({ level: 'warn', event: 'error_report.invalid_dsn' })
      return
    }

    const response = await fetch(target.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=${CLIENT_NAME}`,
      },
      body: buildEnvelope(target, described, context),
      signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn({ level: 'warn', event: 'error_report.rejected', status: response.status })
    }
  } catch (deliveryError) {
    console.warn({
      level: 'warn',
      event: 'error_report.delivery_failed',
      error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
    })
  }
}

/**
 * `reportError` for request handlers: doesn't delay the response. On Workers
 * the delivery is kept alive with `waitUntil`; under Node (local dev, the
 * `app.request()` test helper) there is no ExecutionContext and the promise
 * simply settles on its own.
 */
export function reportRequestError(c: Context, error: unknown, context: ErrorReportContext = {}): void {
  const pending = reportError(error, { method: c.req.method, path: c.req.path, ...context })
  try {
    c.executionCtx.waitUntil(pending)
  } catch {
    // Hono's executionCtx getter throws when there is no ExecutionContext.
  }
}
