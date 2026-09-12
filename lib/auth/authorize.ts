import type { Role } from '@/lib/db/schema-enums'
import type { Session } from './adapter'

/**
 * Throws `Error('Forbidden')` unless `session` is non-null and its role is
 * in `allowedRoles`. Never trust a client-supplied role claim — always call
 * this against a `Session` derived from `getSession()`.
 */
export function requireRole(session: Session | null, allowedRoles: Role[]): asserts session is Session {
  if (!session || !allowedRoles.includes(session.role)) {
    throw new Error('Forbidden')
  }
}
