import { and, count, eq, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munDocuments, munMedia, muns } from '@/lib/db/schema'
import type { MunMediaKind, MunStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'

// -----------------------------------------------------------------------------
// upload-limits — what one MUN may keep in upload storage
// -----------------------------------------------------------------------------
//
// Every upload writes a real object (KV/R2) and, apart from LOGO/COVER, adds
// a row. Without a cap, any organizer account (self-serve signup) could fill
// storage through a MUN it just applied to host. So:
//   - uploads wait for Gate-1 approval (the MUN leaves the application
//     statuses), except for staff;
//   - each media kind and the documents list have a row cap;
//   - the bytes stored for one MUN (media + documents) have a cap.
//
// The caps are checked twice: once before the file is written (cheap early
// refusal), and again inside the insert transaction with the mun row locked,
// so concurrent uploads can't all pass on the same count.

const MB = 1024 * 1024

/** Most rows of each kind one MUN may hold. LOGO and COVER replace the previous file, so they stay at one. */
export const MAX_MEDIA_PER_KIND: Record<MunMediaKind, number> = {
  LOGO: 1,
  COVER: 1,
  GALLERY: 30,
  SPONSOR: 30,
  ORGANIZER_LOGO: 10,
}

export const MAX_DOCUMENTS_PER_MUN = 30

/** Media plus documents, in bytes. */
export const MAX_UPLOAD_BYTES_PER_MUN = 150 * MB

/** Gate-1 application statuses: MUN Hub hasn't approved this MUN (or turned it down). */
const PRE_APPROVAL_STATUSES: readonly MunStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED']

const MEDIA_KIND_LABELS: Record<MunMediaKind, string> = {
  LOGO: 'logos',
  COVER: 'cover images',
  GALLERY: 'gallery images',
  SPONSOR: 'sponsor logos',
  ORGANIZER_LOGO: 'organizer logos',
}

/** Every message this module throws; server/middleware/error.ts maps them to 409. */
export const UPLOAD_LIMIT_ERRORS = {
  notApproved: 'You can upload files once MUN Hub approves your application',
  storageFull: `This MUN has used its ${MAX_UPLOAD_BYTES_PER_MUN / MB}MB of uploads. Delete some files first`,
  tooManyDocuments: `This MUN already has ${MAX_DOCUMENTS_PER_MUN} documents. Delete one first`,
  tooManyMedia: (kind: MunMediaKind) =>
    `This MUN already has ${MAX_MEDIA_PER_KIND[kind]} ${MEDIA_KIND_LABELS[kind]}. Delete one first`,
} as const

/** Matches every `UPLOAD_LIMIT_ERRORS` message. */
export const UPLOAD_LIMIT_ERROR_PATTERN =
  /^(You can upload files once MUN Hub approves your application|This MUN has used its \d+MB of uploads\. Delete some files first|This MUN already has \d+ [a-z ]+\. Delete one first)$/

const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

/**
 * Ownership (owning organizer or admin) plus the Gate-1 rule: organizers can
 * upload only once the MUN is past its application statuses. Throws
 * `Forbidden`, `Mun not found` or `UPLOAD_LIMIT_ERRORS.notApproved`.
 */
export async function assertCanUploadToMun(munId: string, session: Session | null): Promise<void> {
  await assertOwnsOrAdmin(munId, session)
  if (session && (STAFF_ROLES as readonly string[]).includes(session.role)) return

  const [mun] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  if (PRE_APPROVAL_STATUSES.includes(mun.status)) {
    throw new Error(UPLOAD_LIMIT_ERRORS.notApproved)
  }
}

/** A drizzle client or an open transaction. */
type Reader = Pick<typeof db, 'select'>

export type UploadTarget = { area: 'media'; kind: MunMediaKind; replacesKind: boolean } | { area: 'documents' }

/**
 * Throws an `UPLOAD_LIMIT_ERRORS` message if adding `newBytes` for `target`
 * would go over this MUN's caps. With `replacesKind` (LOGO/COVER), the rows
 * of that kind are about to be replaced, so they count neither towards the
 * row cap nor the byte total. Call it inside the insert transaction, after
 * locking the mun row, for the authoritative check.
 */
export async function assertUploadQuota(
  client: Reader,
  munId: string,
  target: UploadTarget,
  newBytes: number,
): Promise<void> {
  const replacedKind = target.area === 'media' && target.replacesKind ? target.kind : null

  const [[mediaTotals], [documentTotals]] = await Promise.all([
    client
      .select({
        bytes: sql<string>`coalesce(sum(${munMedia.sizeBytes}), 0)`,
        ofKind:
          target.area === 'media'
            ? sql<number>`count(*) filter (where ${munMedia.kind} = ${target.kind})`.mapWith(Number)
            : sql<number>`0`.mapWith(Number),
      })
      .from(munMedia)
      .where(replacedKind ? and(eq(munMedia.munId, munId), ne(munMedia.kind, replacedKind)) : eq(munMedia.munId, munId)),
    client
      .select({ bytes: sql<string>`coalesce(sum(${munDocuments.sizeBytes}), 0)`, rows: count() })
      .from(munDocuments)
      .where(eq(munDocuments.munId, munId)),
  ])

  if (target.area === 'media' && !target.replacesKind && mediaTotals.ofKind >= MAX_MEDIA_PER_KIND[target.kind]) {
    throw new Error(UPLOAD_LIMIT_ERRORS.tooManyMedia(target.kind))
  }
  if (target.area === 'documents' && documentTotals.rows >= MAX_DOCUMENTS_PER_MUN) {
    throw new Error(UPLOAD_LIMIT_ERRORS.tooManyDocuments)
  }

  const storedBytes = Number(mediaTotals.bytes) + Number(documentTotals.bytes)
  if (storedBytes + newBytes > MAX_UPLOAD_BYTES_PER_MUN) {
    throw new Error(UPLOAD_LIMIT_ERRORS.storageFull)
  }
}
