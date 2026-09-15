import type { Context } from 'hono'
import { ZodError } from 'zod'
import type { AppEnv } from '../types'

export type ErrorCode =
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

  if (/ not found$/.test(message)) {
    return { status: 404, code: 'NOT_FOUND', message }
  }

  if (/at capacity$/.test(message)) {
    return { status: 409, code: 'CONFLICT_CAPACITY', message }
  }

  if (message === 'You already have an active registration for this product') {
    return { status: 409, code: 'CONFLICT_DUPLICATE', message }
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

export function errorHandler(error: unknown, c: Context<AppEnv>): Response {
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
  { message: 'Mun not found', status: 404, code: 'NOT_FOUND' },
  { message: 'Committee not found', status: 404, code: 'NOT_FOUND' },
  { message: 'Registration product is at capacity', status: 409, code: 'CONFLICT_CAPACITY' },
  { message: 'You already have an active registration for this product', status: 409, code: 'CONFLICT_DUPLICATE' },
  { message: 'This mun already has an active submission in review', status: 409, code: 'CONFLICT_ACTIVE_SUBMISSION' },
  { message: 'Cannot submit mun for review from status PUBLISHED', status: 409, code: 'CONFLICT_STATE' },
  { message: 'Cannot publish — validation fails at PUBLISH stage: Payment verification pending', status: 409, code: 'CONFLICT_STATE' },
  { message: 'duplicate key value violates unique constraint', status: 409, code: 'CONFLICT_UNIQUE' },
]
