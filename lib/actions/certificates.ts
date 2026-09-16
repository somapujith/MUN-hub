import { eq } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { db } from '@/lib/db/client'
import { certificates } from '@/lib/db/schema'

// -----------------------------------------------------------------------------
// Certificates — minimal read-only list (organizer dashboard)
// -----------------------------------------------------------------------------
//
// The `certificates` table (lib/db/schema.ts) is scaffolded per the PRD as
// "no logic/UI in MVP" — there is no certificate-generation pipeline, no
// verification workflow, and nothing in this codebase currently inserts a
// row into it. This file deliberately adds ONLY a list/read action, not a
// full CRUD surface, so the organizer dashboard has somewhere to show
// certificates if/when a future slice starts issuing them. Do not add
// create/update/delete here without first checking whether that future
// slice's design has landed — see CLAUDE.md's "certificates" note.

export type CertificateRow = Awaited<ReturnType<typeof listCertificates>>[number]

/**
 * Certificates issued for a mun, newest first, with the owning delegate's
 * name/email resolved for display. Requires the caller-supplied `session` to
 * own the mun or be an ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise
 * (shared `assertOwnsOrAdmin`, same rule every other organizer-facing list
 * in this codebase uses).
 */
export async function listCertificates(munId: string, session: Session | null) {
  await assertOwnsOrAdmin(munId, session)

  return db.query.certificates.findMany({
    where: eq(certificates.munId, munId),
    columns: {
      id: true,
      userId: true,
      munId: true,
      registrationId: true,
      certificateUrl: true,
      verificationStatus: true,
      createdAt: true,
    },
    with: {
      user: { columns: { id: true, name: true, email: true } },
    },
    orderBy: (row, { desc }) => [desc(row.createdAt)],
  })
}
