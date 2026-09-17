import type { Context } from 'hono'
import { ZodError } from 'zod'
import { ONBOARDING_ERRORS } from '@/lib/actions/organizer-onboarding'
import { ORGANIZER_OTP_ERRORS } from '@/lib/actions/organizer-otp'
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
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
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

  // lib/actions/organizer-otp.ts — passwordless organizer sign-in.
  if (message === ORGANIZER_OTP_ERRORS.incorrect) {
    return { status: 401, code: 'UNAUTHORIZED', message }
  }
  if (message === ORGANIZER_OTP_ERRORS.expired) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }
  if (
    message === ORGANIZER_OTP_ERRORS.cooldown ||
    message === ORGANIZER_OTP_ERRORS.hourlyLimit ||
    message === ORGANIZER_OTP_ERRORS.tooManyAttempts
  ) {
    return { status: 429, code: 'RATE_LIMITED', message }
  }
  if (message === ORGANIZER_OTP_ERRORS.delegateAccount) {
    return { status: 403, code: 'FORBIDDEN', message }
  }
  if (message === ORGANIZER_OTP_ERRORS.deliveryFailed) {
    return { status: 503, code: 'UNAVAILABLE', message }
  }

  // lib/actions/organizer-onboarding.ts
  if (
    message === ONBOARDING_ERRORS.locked ||
    message === ONBOARDING_ERRORS.incomplete ||
    message === ONBOARDING_ERRORS.outOfOrder
  ) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }
  if (
    message === 'PAN must look like ABCDE1234F' ||
    message === 'GSTIN must be a valid 15-character GST number' ||
    message === 'UPI ID must look like name@bank' ||
    message === 'You must accept the organizer agreement to continue' ||
    / must be a 10-digit Indian mobile number$/.test(message)
  ) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }

  // Signup validation (lib/actions/auth.ts, organizer-otp.ts, and the
  // shared `required()` helper) — previously fell through to a 500.
  if (/^You must accept the .+ to create an account$/.test(message) || / is required$/.test(message)) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
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
    if (error instanceof Error && error.cause) {
      console.error(`[${requestId}] cause:`, error.cause)
    }
  }

  const body: ApiErrorBody = {
    error: {
      code: mapped.code,
      message: mapped.status === 500 ? 'Internal server error' : mapped.message,
      ...(mapped.fields ? { fields: mapped.fields } : {}),
      ...(mapped.status === 500 ? { requestId } : {}),
    },
  }

  return c.json(body, mapped.status as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503)
}

/** Exported for integration tests — every known lib throw string must map here. */
export const KNOWN_ERROR_MAPPINGS: Array<{ message: string; status: number; code: ErrorCode }> = [
  { message: 'Forbidden', status: 403, code: 'FORBIDDEN' },
  { message: 'Invalid email or password', status: 401, code: 'UNAUTHORIZED' },
  { message: 'Current password is incorrect', status: 401, code: 'UNAUTHORIZED' },
  { message: 'Account suspended', status: 403, code: 'FORBIDDEN' },
  { message: 'An account with that email already exists', status: 409, code: 'CONFLICT_UNIQUE' },
  { message: ORGANIZER_OTP_ERRORS.incorrect, status: 401, code: 'UNAUTHORIZED' },
  { message: ORGANIZER_OTP_ERRORS.expired, status: 400, code: 'VALIDATION_FAILED' },
  { message: ORGANIZER_OTP_ERRORS.cooldown, status: 429, code: 'RATE_LIMITED' },
  { message: ORGANIZER_OTP_ERRORS.hourlyLimit, status: 429, code: 'RATE_LIMITED' },
  { message: ORGANIZER_OTP_ERRORS.tooManyAttempts, status: 429, code: 'RATE_LIMITED' },
  { message: ORGANIZER_OTP_ERRORS.delegateAccount, status: 403, code: 'FORBIDDEN' },
  { message: ORGANIZER_OTP_ERRORS.deliveryFailed, status: 503, code: 'UNAVAILABLE' },
  { message: 'You must accept the Terms of Service to create an account', status: 400, code: 'VALIDATION_FAILED' },
  { message: ONBOARDING_ERRORS.locked, status: 409, code: 'CONFLICT_STATE' },
  { message: ONBOARDING_ERRORS.incomplete, status: 409, code: 'CONFLICT_STATE' },
  { message: ONBOARDING_ERRORS.outOfOrder, status: 409, code: 'CONFLICT_STATE' },
  { message: 'PAN must look like ABCDE1234F', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'UPI mobile number must be a 10-digit Indian mobile number', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Emergency contact name is required', status: 400, code: 'VALIDATION_FAILED' },
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
