import type { Session } from '@/lib/auth/adapter'

/**
 * Hono context variables — spec Section 13 contract.
 * `session` is set by session middleware on every request (null when absent
 * or invalid). Handlers never read cookies directly.
 */
export type AppVariables = {
  session: Session | null
  requestId: string
}
