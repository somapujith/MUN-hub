import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munMedia, muns } from '@/lib/db/schema'
import type { MunMediaKind } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { deleteStoredObjectQuietly, selectStorageAdapter } from '@/lib/storage/select-adapter'
import { validateUpload, type UploadPurpose } from '@/lib/storage/validate'

// -----------------------------------------------------------------------------
// mun-branding — BRANDING module (PRD Section 11, design doc Section 2.3)
// -----------------------------------------------------------------------------
//
// Upload validation happens before the storage adapter is ever touched
// (design doc Section 8, invariant #6): content-type allowlist, size cap and
// file signature (lib/storage/validate.ts, called below), and a
// server-generated storage key. The key is never derived from the
// caller-supplied filename — that would let a crafted filename escape the
// mun's storage prefix (path traversal). LOGO and COVER are upsert-by-kind:
// at most one row of each kind may exist per mun, enforced here (not a DB
// constraint — see design doc Section 2.3) by deleting any existing row of
// that kind before inserting the new one, inside one transaction that
// row-locks the mun so two concurrent uploads of the same kind can't both
// see "no existing row" and leave two. The replaced rows' storage objects are
// deleted after that transaction commits.

const UPSERT_KINDS: MunMediaKind[] = ['LOGO', 'COVER']

/** Size/type rules per media kind (lib/storage/validate.ts): logos 2MB, covers and gallery images 5MB. */
const UPLOAD_PURPOSE: Record<MunMediaKind, UploadPurpose> = {
  LOGO: 'LOGO',
  ORGANIZER_LOGO: 'LOGO',
  SPONSOR: 'LOGO',
  COVER: 'COVER',
  GALLERY: 'IMAGE',
}

export interface MunMediaItem {
  id: string
  munId: string
  kind: MunMediaKind
  url: string
  storageKey: string
  contentType: string
  sizeBytes: number
  displayOrder: number
  createdAt: Date
}

export interface UploadMunMediaInput {
  munId: string
  kind: MunMediaKind
  file: Buffer
  contentType: string
  displayOrder?: number
}

/**
 * Uploads a branding asset (logo, cover, gallery image, sponsor logo, or
 * organizer logo). Validates type, size and contents BEFORE touching
 * storage. For LOGO/COVER kinds, replaces any existing row of that kind
 * (upsert semantics) — the delete-then-insert is wrapped in a transaction
 * that locks the mun row, so it can't race with itself.
 */
export async function uploadMunMedia(input: UploadMunMediaInput, session: Session | null): Promise<MunMediaItem> {
  await assertOwnsOrAdmin(input.munId, session)
  validateUpload(input.file, input.contentType, UPLOAD_PURPOSE[input.kind])

  const storage = selectStorageAdapter()
  const key = `muns/${input.munId}/branding/${crypto.randomUUID()}`
  const { url } = await storage.upload(input.file, key, input.contentType)

  const values = {
    munId: input.munId,
    kind: input.kind,
    url,
    storageKey: key,
    contentType: input.contentType,
    sizeBytes: input.file.byteLength,
    displayOrder: input.displayOrder ?? 0,
  }

  let created: MunMediaItem
  let replacedKeys: string[] = []

  // Storage can't take part in the SQL transaction, so the order is chosen
  // to fail safe:
  //   - the new object is written first (above); if the DB write below
  //     fails, nothing references it, so it is deleted again here;
  //   - replaced objects are deleted only after the transaction commits, so
  //     a rollback never leaves a row pointing at a deleted object.
  // Both deletes are best effort (logged, not thrown): a leftover object
  // costs storage, not correctness.
  try {
    if (!UPSERT_KINDS.includes(input.kind)) {
      ;[created] = await db.insert(munMedia).values(values).returning()
    } else {
      const result = await db.transaction(async (tx) => {
        await tx.select({ id: muns.id }).from(muns).where(eq(muns.id, input.munId)).for('update')

        const existingOfKind = await tx
          .select({ id: munMedia.id, storageKey: munMedia.storageKey })
          .from(munMedia)
          .where(and(eq(munMedia.munId, input.munId), eq(munMedia.kind, input.kind)))

        for (const row of existingOfKind) {
          await tx.delete(munMedia).where(eq(munMedia.id, row.id))
        }

        const [insertedRow] = await tx.insert(munMedia).values(values).returning()
        return { insertedRow, replacedKeys: existingOfKind.map((row) => row.storageKey) }
      })
      created = result.insertedRow
      replacedKeys = result.replacedKeys
    }
  } catch (error) {
    await deleteStoredObjectQuietly(storage, key, 'uploadMunMedia rollback')
    throw error
  }

  for (const replacedKey of replacedKeys) {
    await deleteStoredObjectQuietly(storage, replacedKey, `uploadMunMedia replacing ${input.kind}`)
  }

  await onModuleDataChanged(input.munId, 'BRANDING', session!.userId)

  return created
}

/** Public read, no auth — the mun detail page and organizer dashboard both render gallery/branding assets. */
export async function listMunMedia(munId: string): Promise<MunMediaItem[]> {
  return db.select().from(munMedia).where(eq(munMedia.munId, munId)).orderBy(asc(munMedia.displayOrder))
}

/**
 * Deletes a media row, then its storage object. Owning organizer or admin
 * only. The object delete is best effort (logged, not thrown), as in
 * deleteMunDocument.
 */
export async function deleteMunMedia(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munMedia.munId, storageKey: munMedia.storageKey })
    .from(munMedia)
    .where(eq(munMedia.id, id))
    .limit(1)
  if (!existing) throw new Error('Media not found')
  await assertOwnsOrAdmin(existing.munId, session)

  await db.delete(munMedia).where(eq(munMedia.id, id))
  await deleteStoredObjectQuietly(selectStorageAdapter(), existing.storageKey, 'deleteMunMedia')

  await onModuleDataChanged(existing.munId, 'BRANDING', session!.userId)
}

/**
 * Reorders the GALLERY images for a mun by writing `displayOrder` from the
 * given id order. Owning organizer or admin only. IDOR check consistent with
 * the committeeId cross-mun checks in executive-board.ts/mun-schedule.ts: if
 * ANY id in `orderedIds` doesn't belong to `munId`, the whole call is
 * rejected — a caller must never be able to smuggle a foreign mun's media id
 * into a reorder and have it silently ignored while the rest of the reorder
 * partially succeeds.
 */
export async function reorderGallery(munId: string, orderedIds: string[], session: Session | null): Promise<void> {
  await assertOwnsOrAdmin(munId, session)

  if (orderedIds.length === 0) return

  const rows = await db
    .select({ id: munMedia.id })
    .from(munMedia)
    .where(and(eq(munMedia.munId, munId), inArray(munMedia.id, orderedIds)))
  const validIds = new Set(rows.map((r) => r.id))

  const foreignIds = orderedIds.filter((id) => !validIds.has(id))
  if (foreignIds.length > 0) {
    throw new Error('One or more ids do not belong to this mun')
  }

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.update(munMedia).set({ displayOrder: index }).where(eq(munMedia.id, id))
    }
  })

  await onModuleDataChanged(munId, 'BRANDING', session!.userId)
}
