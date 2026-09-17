import { eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications } from '@/lib/db/schema'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'

export type OrganizerApplication = InferSelectModel<typeof organizerApplications>

export interface SubmitOrganizerApplicationInput {
  // IMPORTANT: `organizerId` is trusted as a plain parameter here — this is
  // NOT the general "never trust client userId" pattern being ignored. It is
  // safe ONLY because this action *creates a new row owned by exactly this
  // id* (a mun + application record attributed to organizerId); it never
  // reads or mutates another user's existing data. Callers (server actions /
  // route handlers) must still have verified the session server-side via
  // `getSession()` before calling this and must pass that session's userId
  // here — do not wire this up to accept an arbitrary client-supplied id
  // from a request body. Do not "fix" this by making organizerId implicit
  // via getSession() inside this function: keeping it an explicit parameter
  // is what lets this function stay a plain, testable unit that doesn't
  // depend on the Next.js request/cookie context.
  organizerId: string
  conferenceName: string
  expectedDate: Date
  location: string
  expectedDelegateCount: number
  description: string
  previousEditions?: string
  websiteUrl?: string
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Subdomain labels reserved for role-based hosts (app.munhub.in, etc.) and the
// api/www hosts — a MUN can never be allocated one of these as its slug, or
// its wildcard-subdomain page would collide with a role console.
// docs/superpowers/specs/2026-09-17-subdomain-architecture-design.md §2
// `publish` is the organizer host; `organize` stays reserved because it's still
// served as an alias for it.
const RESERVED_SLUGS = new Set(['www', 'app', 'publish', 'organize', 'admin', 'api'])

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'mun'

  if (!RESERVED_SLUGS.has(base)) {
    const [existing] = await db.select({ id: muns.id }).from(muns).where(eq(muns.slug, base)).limit(1)
    if (!existing) return base
  }

  // Base slug taken (or reserved) — append a short uniqueness suffix and retry until free.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 8)}`
    if (RESERVED_SLUGS.has(candidate)) continue
    const [clash] = await db.select({ id: muns.id }).from(muns).where(eq(muns.slug, candidate)).limit(1)
    if (!clash) return candidate
  }

  // Extremely unlikely fallback: timestamp is guaranteed-unique enough here.
  return `${base}-${Date.now()}`
}

/**
 * Submits a new organizer application: creates a MUN (starting DRAFT, then
 * immediately transitioned to SUBMITTED via the lifecycle state machine so
 * the transition is validated and audit-logged) and a linked
 * `organizerApplications` row, also SUBMITTED.
 *
 * Per PRD: the act of submitting the organizer application IS the SUBMITTED
 * trigger — the mun must not be left in DRAFT.
 */
export async function submitOrganizerApplication(
  input: SubmitOrganizerApplicationInput,
): Promise<OrganizerApplication> {
  const slug = await generateUniqueSlug(input.conferenceName)

  const [draftMun] = await db
    .insert(muns)
    .values({
      organizerId: input.organizerId,
      name: input.conferenceName,
      slug,
      description: input.description,
      startDate: input.expectedDate,
      city: input.location,
      status: 'DRAFT',
    })
    .returning()

  await transitionMun(draftMun.id, 'SUBMITTED', input.organizerId)

  const [application] = await db
    .insert(organizerApplications)
    .values({
      organizerId: input.organizerId,
      munId: draftMun.id,
      status: 'SUBMITTED',
    })
    .returning()

  return application
}
