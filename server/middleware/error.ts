import type { Context } from 'hono'
import { ZodError } from 'zod'
import { APPLICATION_PENDING } from '@/lib/actions/organizer-application'
import { ONBOARDING_ERRORS } from '@/lib/actions/organizer-onboarding'
import { ORGANIZER_OPS_ERROR_STATUS } from '@/lib/actions/organizer-ops-errors'
import { ORGANIZER_OTP_ERRORS } from '@/lib/actions/organizer-otp'
import { MFA_ERRORS } from '@/lib/actions/staff-mfa'
import { MODULE_LOCKED_PATTERN } from '@/lib/lifecycle/module-completion'
import { STORAGE_NOT_CONFIGURED_MESSAGE } from '@/lib/storage/select-adapter'
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

  // lib/storage/select-adapter.ts — no storage binding: uploads are refused, not discarded.
  if (message === STORAGE_NOT_CONFIGURED_MESSAGE) {
    return { status: 503, code: 'UNAVAILABLE', message }
  }

  // lib/actions/{organizer-dashboard,check-in,organizer-communications,results}.ts
  if (Object.hasOwn(ORGANIZER_OPS_ERROR_STATUS, message)) {
    return { ...ORGANIZER_OPS_ERROR_STATUS[message], message }
  }

  // lib/actions/staff-mfa.ts — staff TOTP enrollment + sign-in challenge.
  if (message === MFA_ERRORS.staffOnly) {
    return { status: 403, code: 'FORBIDDEN', message }
  }
  if (message === MFA_ERRORS.alreadyEnrolled || message === MFA_ERRORS.notEnrolled) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }
  if (message === MFA_ERRORS.invalidCode) {
    return { status: 401, code: 'UNAUTHORIZED', message }
  }
  if (message === MFA_ERRORS.expired) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }
  if (message === MFA_ERRORS.tooManyAttempts) {
    return { status: 429, code: 'RATE_LIMITED', message }
  }

  if (message === APPLICATION_PENDING) {
    return { status: 409, code: 'CONFLICT_DUPLICATE', message }
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
    message === 'Expected start date must be a valid date' ||
    /^Maximum expected delegates must be a whole number from 1 to \d+$/.test(message) ||
    /^Description must be at least \d+ characters$/.test(message) ||
    message === 'Website must be a full URL, including https://' ||
    message === 'UPI ID must look like name@bank' ||
    message === 'You must accept the organizer agreement to continue' ||
    message === 'You must confirm the submission is accurate and complete' ||
    message === 'Registration deadline must be after registration opens' ||
    message === 'Registration deadline must be before the conference starts' ||
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
    message === 'This reset link is invalid or has expired' ||
    message === 'This verification link is invalid or has expired'
  ) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
  }

  // lib/actions/email-verification.ts#assertEmailVerifiedIfRequired — not
  // wired into any route by this lane (that's the registration owner's
  // call), but mapped here in advance so it doesn't fall through to a 500
  // once it is.
  if (message === 'Please verify your email address before registering for a MUN') {
    return { status: 403, code: 'FORBIDDEN', message }
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

  // lib/actions/mun-config.ts portfolio writes.
  if (/^A portfolio named ".+" already exists in this committee$/.test(message)) {
    return { status: 409, code: 'CONFLICT_UNIQUE', message }
  }
  if (message === 'Add at least one portfolio' || /^You can add at most \d+ portfolios at once$/.test(message)) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
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

  // lib/lifecycle/module-completion.ts#assertModuleNotLocked and
  // organizer-confirmation.ts#submitFinalConfirmation — previously 500s.
  if (MODULE_LOCKED_PATTERN.test(message)) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (/^Cannot (submit|publish|transition|confirm|queue|withdraw)/.test(message)) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (message.includes('Cannot submit mun for review from status')) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  if (message.includes('Cannot publish — validation fails at PUBLISH stage')) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  // Lifecycle/state conflicts: the target exists but is in the wrong state
  // for the requested action (lib/lifecycle/mun-state-machine.ts,
  // module-verification.ts, go-live.ts; lib/actions/support.ts).
  if (
    /^Invalid transition from \w+ to \w+$/.test(message) ||
    /^Invalid ticket transition: \w+ -> \w+$/.test(message) ||
    /^Module "\w+" was already reviewed \(current state: \w+\) — reload and try again$/.test(message) ||
    /^Module "\w+" cannot be confirmed from its current state \(\w+\)$/.test(message) ||
    message === 'No submission found for this mun' ||
    message === 'No active submission found for this mun'
  ) {
    return { status: 409, code: 'CONFLICT_STATE', message }
  }

  // Input validation thrown from lib/ (mun-schedule.ts, accommodation.ts,
  // mun-branding.ts, module-verification.ts, go-live.ts).
  if (
    message === 'endsAt must be after startsAt' ||
    /^Field type \w+ requires at least one choice$/.test(message) ||
    message === 'One or more ids do not belong to this mun' ||
    /^Unsupported content type ".*" — allowed types are /.test(message) ||
    /^File too large \(\d+ bytes\) — maximum allowed size is /.test(message) ||
    message === 'FINAL_REVIEW cannot be made optional' ||
    message === 'A non-empty reason is required to reject a submission' ||
    message === 'A reason is required to reject or request changes'
  ) {
    return { status: 400, code: 'VALIDATION_FAILED', message }
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
  { message: STORAGE_NOT_CONFIGURED_MESSAGE, status: 503, code: 'UNAVAILABLE' },
  { message: 'You must accept the Terms of Service to create an account', status: 400, code: 'VALIDATION_FAILED' },
  { message: ONBOARDING_ERRORS.locked, status: 409, code: 'CONFLICT_STATE' },
  { message: ONBOARDING_ERRORS.incomplete, status: 409, code: 'CONFLICT_STATE' },
  { message: ONBOARDING_ERRORS.outOfOrder, status: 409, code: 'CONFLICT_STATE' },
  { message: 'Maximum expected delegates must be a whole number from 1 to 10000', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Description must be at least 40 characters', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'MUN title is required', status: 400, code: 'VALIDATION_FAILED' },
  { message: APPLICATION_PENDING, status: 409, code: 'CONFLICT_DUPLICATE' },
  {
    message: 'Portfolios is locked while MUN Hub reviews this MUN. You can edit it again if a reviewer sends it back.',
    status: 409,
    code: 'CONFLICT_STATE',
  },
  { message: 'Cannot confirm — validation now fails: Venue is set', status: 409, code: 'CONFLICT_STATE' },
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
  { message: 'Invalid transition from APPROVED to APPROVED', status: 409, code: 'CONFLICT_STATE' },
  { message: 'Invalid ticket transition: NEW -> CLOSED', status: 409, code: 'CONFLICT_STATE' },
  { message: 'Module "BASIC_INFO" was already reviewed (current state: VERIFIED) — reload and try again', status: 409, code: 'CONFLICT_STATE' },
  { message: 'Module "BASIC_INFO" cannot be confirmed from its current state (VERIFIED)', status: 409, code: 'CONFLICT_STATE' },
  { message: 'No submission found for this mun', status: 409, code: 'CONFLICT_STATE' },
  { message: 'No active submission found for this mun', status: 409, code: 'CONFLICT_STATE' },
  { message: 'endsAt must be after startsAt', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Field type DROPDOWN requires at least one choice', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'One or more ids do not belong to this mun', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Unsupported content type "image/gif" — allowed types are image/png, image/jpeg, image/webp', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'File too large (6000000 bytes) — maximum allowed size is 5MB', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'FINAL_REVIEW cannot be made optional', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'A non-empty reason is required to reject a submission', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'A reason is required to reject or request changes', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'A portfolio named "India" already exists in this committee', status: 409, code: 'CONFLICT_UNIQUE' },
  { message: 'Add at least one portfolio', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'You can add at most 300 portfolios at once', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Portfolio name is required', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'You must confirm the submission is accurate and complete', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Registration deadline must be after registration opens', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Registration deadline must be before the conference starts', status: 400, code: 'VALIDATION_FAILED' },
  { message: 'Cannot queue — these sections still need review: COMMITTEES', status: 409, code: 'CONFLICT_STATE' },
  { message: 'Cannot submit results while the MUN is ONBOARDING', status: 409, code: 'CONFLICT_STATE' },
  { message: 'No confirmed registration for this MUN matches that code', status: 404, code: 'NOT_FOUND' },
  { message: 'This MUN has reached its limit of 5 delegate messages per hour — try again later', status: 429, code: 'RATE_LIMITED' },
  { message: MFA_ERRORS.staffOnly, status: 403, code: 'FORBIDDEN' },
  { message: MFA_ERRORS.alreadyEnrolled, status: 409, code: 'CONFLICT_STATE' },
  { message: MFA_ERRORS.notEnrolled, status: 409, code: 'CONFLICT_STATE' },
  { message: MFA_ERRORS.invalidCode, status: 401, code: 'UNAUTHORIZED' },
  { message: MFA_ERRORS.expired, status: 400, code: 'VALIDATION_FAILED' },
  { message: MFA_ERRORS.tooManyAttempts, status: 429, code: 'RATE_LIMITED' },
]
