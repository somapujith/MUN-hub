import { and, desc, eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerApplications, users } from '@/lib/db/schema'
import type { ApplicationStatus, MunStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'

export type OrganizerApplication = InferSelectModel<typeof organizerApplications>

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Tx | typeof db

/** Thrown while an earlier application of the same organizer is still waiting for Gate-1 review. */
export const APPLICATION_PENDING =
  'Your previous application is still being reviewed. You can apply for another MUN once it has been reviewed.'

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

async function generateUniqueSlug(client: Executor, name: string): Promise<string> {
  const base = slugify(name) || 'mun'

  if (!RESERVED_SLUGS.has(base)) {
    const [existing] = await client.select({ id: muns.id }).from(muns).where(eq(muns.slug, base)).limit(1)
    if (!existing) return base
  }

  // Base slug taken (or reserved) — append a short uniqueness suffix and retry until free.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 8)}`
    if (RESERVED_SLUGS.has(candidate)) continue
    const [clash] = await client.select({ id: muns.id }).from(muns).where(eq(muns.slug, candidate)).limit(1)
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
  return db.transaction(async (tx) => {
    // `organizer_applications` has no unique constraint that would stop two
    // SUBMITTED rows for the same organizer (migration 0030 dropped the old
    // organizer_id unique index — an organizer may host several MUNs over
    // time), so the "one at a time" rule is enforced here instead. A bare
    // SELECT-then-INSERT would let N parallel requests all read "nothing
    // pending" and each create a MUN + application; row-locking the
    // organizer's own `users` row first serializes those callers, so the
    // second one re-reads the check after the first commits and is refused.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.organizerId)).limit(1).for('update')

    // An organizer may host several MUNs (one application per MUN), but only
    // one application can wait for review at a time. Checked before anything
    // is written — and inside this transaction, so a refused application
    // never leaves a stray mun behind.
    const [pending] = await tx
      .select({ id: organizerApplications.id })
      .from(organizerApplications)
      .where(
        and(eq(organizerApplications.organizerId, input.organizerId), eq(organizerApplications.status, 'SUBMITTED')),
      )
      .limit(1)
    if (pending) throw new Error(APPLICATION_PENDING)

    const slug = await generateUniqueSlug(tx, input.conferenceName)

    const [draftMun] = await tx
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

    await transitionMun(draftMun.id, 'SUBMITTED', input.organizerId, undefined, undefined, tx)

    const [application] = await tx
      .insert(organizerApplications)
      .values({
        organizerId: input.organizerId,
        munId: draftMun.id,
        status: 'SUBMITTED',
        expectedDelegateCount: input.expectedDelegateCount,
        previousEditions: input.previousEditions?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
      })
      .returning()

    return application
  })
}

export interface OrganizerApplicationSummary {
  id: string
  munId: string | null
  munName: string | null
  munSlug: string | null
  munStatus: MunStatus | null
  status: ApplicationStatus
  /** The Gate-1 reviewer's note to the organizer, if any. */
  reviewNotes: string | null
  submittedAt: Date
}

/** The signed-in organizer's own host applications, newest first. */
export async function listMyOrganizerApplications(session: Session | null): Promise<OrganizerApplicationSummary[]> {
  if (!session || session.role !== 'ORGANIZER') throw new Error('Forbidden')
  return db
    .select({
      id: organizerApplications.id,
      munId: organizerApplications.munId,
      munName: muns.name,
      munSlug: muns.slug,
      munStatus: muns.status,
      status: organizerApplications.status,
      reviewNotes: organizerApplications.reviewNotes,
      submittedAt: organizerApplications.submittedAt,
    })
    .from(organizerApplications)
    .leftJoin(muns, eq(muns.id, organizerApplications.munId))
    .where(eq(organizerApplications.organizerId, session.userId))
    .orderBy(desc(organizerApplications.submittedAt))
}
