import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'

// -----------------------------------------------------------------------------
// resolve-recipients — Task 12 Step 5 support helpers for wiring
// notifyPipelineEvent into call sites (go-live.ts, module-verification.ts).
//
// Deliberately a SEPARATE file from lib/notifications/pipeline-events.ts —
// that file was built by a peer session and must not be modified/recreated
// (see task brief). These are plain DB-resolution helpers, not part of the
// pure render/send surface pipeline-events.ts owns.
// -----------------------------------------------------------------------------

const ADMIN_NOTIFICATION_ROLES = ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS'] as const

/**
 * Resolves the email addresses of every user with an admin/ops role
 * (ADMIN, SUPER_ADMIN, OPERATIONS) — the recipient set for every
 * admin-facing `PipelineEvent` (NEW_SUBMISSION, RESUBMISSION,
 * PAYMENT_VERIFICATION_ISSUE, CRITICAL_VALIDATION_FAILURE). No existing
 * helper in the codebase already does this (checked `admin-review.ts`,
 * `organizer-admin.ts` — both query ORGANIZER-role users, not admin/ops), so
 * this is new. Returns an empty array (never throws) if no such users exist
 * yet — `notifyPipelineEvent` fans out over `to` with `Promise.all`, so an
 * empty array is simply zero notifications sent, not an error.
 */
export async function resolveAdminEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.role, [...ADMIN_NOTIFICATION_ROLES]))
  return rows.map((row) => row.email)
}

export interface MunNotificationContext {
  munName: string
  organizerEmail: string
  slug: string
}

/**
 * Resolves the `{ munName, organizerEmail, slug }` a `PipelineEvent` needs,
 * joining `muns` to its owning organizer's `users` row. Throws
 * `Error('Mun not found')` / `Error('Organizer not found')` rather than
 * returning a partial/undefined result — a notification call site that
 * can't resolve this has a real data-integrity problem worth surfacing, not
 * silently skipping the notification.
 */
export async function resolveMunNotificationContext(munId: string): Promise<MunNotificationContext> {
  const [mun] = await db
    .select({ name: muns.name, slug: muns.slug, organizerId: muns.organizerId })
    .from(muns)
    .where(eq(muns.id, munId))
    .limit(1)
  if (!mun) throw new Error('Mun not found')

  const [organizer] = await db.select({ email: users.email }).from(users).where(eq(users.id, mun.organizerId)).limit(1)
  if (!organizer) throw new Error('Organizer not found')

  return { munName: mun.name, organizerEmail: organizer.email, slug: mun.slug }
}

/**
 * Builds the public marketplace URL for a mun, matching the exact pattern
 * `app/sitemap.ts` already uses (`NEXT_PUBLIC_APP_URL` env var, falling back
 * to localhost for dev) — kept in one place so the two never drift apart.
 */
export function buildPublicMunUrl(slug: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${baseUrl}/mun/${slug}`
}
