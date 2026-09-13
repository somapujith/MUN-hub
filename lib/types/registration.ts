import type { InferSelectModel } from 'drizzle-orm'
import type { registrations } from '@/lib/db/schema'
import type { RegistrationStatus } from '@/lib/db/schema-enums'

export type Registration = InferSelectModel<typeof registrations>

/**
 * Input shape for creating a registration.
 *
 * IMPORTANT (IDOR): `userId` is intentionally optional here. Server actions
 * MUST derive the acting user from `getSession()` and must never accept a
 * client-supplied `userId` for a mutation/read of a specific user's data.
 * The optional field exists only so internal server-side code (e.g. a
 * service function called after the session has already been resolved) can
 * construct a fully-formed `RegistrationInput` without re-deriving it —
 * callers in the action layer must not accept `userId` from request bodies.
 */
export interface RegistrationInput {
  userId?: string
  munId: string
  registrationProductId: string
  committeeId?: string
  portfolioId?: string
  formResponses?: Record<string, unknown>
  /** Optional — accommodation is priced additively into the same payment. */
  accommodationOptionId?: string
  accommodationAnswers?: Record<string, unknown>
}

export type { RegistrationStatus }
