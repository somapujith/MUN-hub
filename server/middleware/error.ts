import type { Context } from 'hono'
import { ZodError } from 'zod'
import type { AppVariables } from '../src/types'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT_CAPACITY'
  | 'CONFLICT_DUPLICATE'
  | 'CONFLICT_ACTIVE_SUBMISSION'
  | 'CONFLICT_STATE'
  | 'CONFLICT_UNIQUE'
  | 'VALIDATION_FAILED'
  | 'INTERNAL'

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    fields?: Record<string, string[]>
    requestId?: string
  }
}

/** Maps lib-layer thrown strings to HTTP status + stable error codes (spec §3.4). */
export function mapThrownError(error: unknown): { status: number; code: ErrorCode; message: string; fields?: Record<string, string[]> } {
  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_root'
      fields[key] ??= []
      fields[key].push(issue.message)
    }
    return { status: 400, code: 'VALIDATION_FAILED', message: 'Validation failed', fields }
  }

  const message = error instanceof Error ? error.message : String(error)

  if (message === 'Forbidden') {
    return { status: 403, code: 'FORBIDDEN', message: 'Forbidden' }
  }

  // lib/actions/auth.ts (real password sign-in/sign-up/change-password) —
  // without these, every wrong-password/duplicate-email throw fell through
  // to the generic 500 INTERNAL branch below, hiding the actual message
  // from the sign-in/sign-up forms and mislabeling expected auth failures
  // as unhandled server errors in the logs.
  if (message === 'Invalid email or password' || message === 'Current password is incorrect') {
    return { status: 401, code: 'UNAUTHORIZED', message }
  }

  if (message === 'Account suspended') {
    return { status: 403, code: 'FORBIDDEN', message }
  }

  if (message === 'An account with that email already exists') {
    return { status: 409, code: 'CONFLICT_UNIQUE', message }
  }

  if (
    message === 'Name is required' ||
    /^Password must be at least \d+ characters$/.test(message) ||
    message === 'This reset link is invalid or has expired'
  ) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }

  if (/ not found$/.test(message)) {
    return { status: 404, code: 'NOT_FOUND', message }
  }

  // lib/actions/registration-form.ts — the form-field-builder UI's validation
  // errors (duplicate fieldKey, bad/cyclical conditionalOn, missing choices,
  // delete blocked by a dependent field, reorder referencing a foreign id)
  // previously fell through to the generic 500 INTERNAL branch below, hiding
  // the real, actionable message from the organizer.
  if (message.includes('is already used on this mun')) {
    return { status: 409, code: 'CONFLICT_UNIQUE', message }
  }

  if (
    message.includes('conditionalOn references unknown fieldKey') ||
    message.includes('would create a cycle via') ||
    message.includes("exceeds the mun's field count") ||
    /^Field type .+ requires a non-empty choices array$/.test(message) ||
    /^Field .+ does not belong to mun /.test(message)
  ) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }

  if (/^Cannot delete field ".+": referenced by conditionalOn on/.test(message)) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (/at capacity$/.test(message)) {
    return { status: 409, code: 'CONFLICT_CAPACITY', message }
  }

  if (message === 'You already have an active registration for this product') {
    return { status: 409, code: 'CONFLICT_DUPLICATE', message }
  }

  if (message === 'Message cannot be empty') {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }

  if (message === 'This conversation is closed.') {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (message === 'This mun already has an active submission in review') {
    return { status: 409, code: 'CONFLICT_ACTIVE_SUBMISSION', message }
  }

  if (/^Cannot (submit|publish|transition)/.test(message)) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (message.includes('Cannot submit mun for review from status')) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (message.includes('Cannot publish — validation fails at PUBLISH stage')) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (message.includes('unique constraint') || message.includes('23505') || message.includes('duplicate key')) {
    return { status: 409, code: 'CONFLICT_UNIQUE', message: 'Resource already exists' }
  }

  return { status: 500, code: 'INTERNAL', message: 'Internal server error' }
}

export function errorHandler(error: unknown, c: Context<{ Variables: AppVariables }>): Response {
  const requestId = c.get('requestId') ?? crypto.randomUUID()
  const mapped = mapThrownError(error)

  if (mapped.status === 500) {
    console.error(`[${requestId}] unhandled error`, error)
  }

  const body: ApiErrorBody = {
    error: {
      code: mapped.code,
      message: mapped.status === 500 ? 'Internal server error' : mapped.message,
      ...(mapped.fields ? { fields: mapped.fields } : {}),
      ...(mapped.status === 500 ? { requestId } : {}),
    },
  }

  return c.json(body, mapped.status as 400 | 403 | 404 | 409 | 500)
}

/** Exported for integration tests — every known lib throw string must map here. */
export const KNOWN_ERROR_MAPPINGS: Array<{ message: string; status: number; code: ErrorCode }> = [
  { message: 'Forbidden', status: 403, code: 'FORBIDDEN' },
  { message: 'Invalid email or password', status: 401, code: 'UNAUTHORIZED' },
  { message: 'Current password is incorrect', status: 401, code: 'UNAUTHORIZED' },
  { message: 'Account suspended', status: 403, code: 'FORBIDDEN' },
  { message: 'An account with that email already exists', status: 409, code: 'CONFLICT_UNIQUE' },
  { message: 'Mun not found', status: 404, code: 'NOT_FOUND' },
  { message: 'Committee not found', status: 404, code: 'NOT_FOUND' },
  { message: 'Ticket not found', status: 404, code: 'NOT_FOUND' },
  { message: 'Registration product is at capacity', status: 409, code: 'CONFLICT_CAPACITY' },
  { message: 'You already have an active registration for this product', status: 409, code: 'CONFLICT_DUPLICATE' },
  { message: 'Message cannot be empty', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'This conversation is closed.', status: 409, code: 'CONFLICT_STATE' },
  { message: 'This mun already has an active submission in review', status: 409, code: 'CONFLICT_ACTIVE_SUBMISSION' },
  { message: 'Cannot submit mun for review from status PUBLISHED', status: 409, code: 'CONFLICT_STATE' },
  { message: 'Cannot publish — validation fails at PUBLISH stage: Payment verification pending', status: 409, code: 'CONFLICT_STATE' },
  { message: 'duplicate key value violates unique constraint', status: 409, code: 'CONFLICT_UNIQUE' },
  { message: 'fieldKey "school" is already used on this mun — fieldKey must be unique per mun', status: 409, code: 'CONFLICT_UNIQUE' },
  { message: 'conditionalOn references unknown fieldKey "ghost" on this mun', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'conditionalOn on "a" would create a cycle via "b"', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Field type DROPDOWN requires a non-empty choices array', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Cannot delete field "school": referenced by conditionalOn on grade', status: 409, code: 'CONFLICT_STATE' },
]
