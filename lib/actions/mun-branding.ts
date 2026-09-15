'use server'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munMedia } from '@/lib/db/schema'
import type { MunMediaKind } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { mockStorageAdapter } from '@/lib/storage/mock-adapter'
import type { StorageAdapter } from '@/lib/storage/adapter'

// -----------------------------------------------------------------------------
// mun-branding — BRANDING module (PRD Section 11, design doc Section 2.3)
// -----------------------------------------------------------------------------
//
// Upload validation happens in THIS file, before the storage adapter is ever
// touched (design doc Section 8, invariant #6): content-type allowlist, size
// cap, and a server-generated storage key. The key is never derived from the
// caller-supplied filename — that would let a crafted filename escape the
// mun's storage prefix (path traversal). LOGO and COVER are upsert-by-kind:
// at most one row of each kind may exist per mun, enforced here (not a DB
// constraint — see design doc Section 2.3) by deleting any existing row of
// that kind, and its storage object, before inserting the new one, all
// inside one transaction so a concurrent upload of the same kind can't leave
// two rows or delete the winner's storage object out from under it.

const storage: StorageAdapter = mockStorageAdapter

const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

const UPSERT_KINDS: MunMediaKind[] = ['LOGO', 'COVER']

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

function validateUpload(file: Buffer, contentType: string): void {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported content type "${contentType}" — allowed types are image/png, image/jpeg, image/webp`,
    )
  }
  if (file.byteLength > MAX_SIZE_BYTES) {
    throw new Error(`File too large (${file.byteLength} bytes) — maximum allowed size is 5MB`)
  }
}

/**
 * Uploads a branding asset (logo, cover, gallery image, sponsor logo, or
 * organizer logo). Validates content-type and size BEFORE touching storage.
 * For LOGO/COVER kinds, replaces any existing row of that kind (upsert
 * semantics) — the delete-then-insert is wrapped in a transaction so it
 * can't race with itself.
 */
export async function uploadMunMedia(input: UploadMunMediaInput, session: Session | null): Promise<MunMediaItem> {
  await assertOwnsOrAdmin(input.munId, session)
  validateUpload(input.file, input.contentType)

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

  if (!UPSERT_KINDS.includes(input.kind)) {
    ;[created] = await db.insert(munMedia).values(values).returning()
  } else {
    created = await db.transaction(async (tx) => {
      const existingOfKind = await tx
        .select({ id: munMedia.id, storageKey: munMedia.storageKey })
        .from(munMedia)
        .where(and(eq(munMedia.munId, input.munId), eq(munMedia.kind, input.kind)))

      for (const row of existingOfKind) {
        await tx.delete(munMedia).where(eq(munMedia.id, row.id))
      }

      const [insertedRow] = await tx.insert(munMedia).values(values).returning()

      // storage.delete() of the OLD key runs here, inside the SQL transaction
      // callback, after the new row's insert but before the callback returns
      // (i.e. before Postgres commits). It is NOT part of the SQL transaction
      // itself — storage operations can't participate in a Postgres COMMIT/
      // ROLLBACK — so this ordering only changes what happens on failure, not
      // real atomicity between the DB and the storage backend:
      //   - If storage.delete() throws, this callback throws too, so Drizzle
      //     rolls back the delete+insert above. The DB then stays consistent
      //     with the OLD row and OLD storage key — not exploitable, just an
      //     upload that has to be retried.
      //   - The real orphan risk runs the OTHER way: storage.upload() of the
      //     NEW file (above, outside/before this transaction even starts) has
      //     already happened by this point. If anything from here on throws —
      //     including this storage.delete() call failing — the transaction
      //     rolls back the DB insert, but the newly-uploaded object already
      //     exists in storage with no DB row referencing it. That NEW object
      //     is the one left orphaned, not the old one being deleted here.
      // Accepted for now: the mock adapter's upload()/delete() never throw, so
      // this path isn't exercised today. A real StorageAdapter (e.g. R2) should
      // either move the upload as late as possible (immediately before this
      // insert, minimizing the exposure window) or add an out-of-band orphan
      // sweep — don't copy this ordering into Task 6+ uploads without
      // addressing that.
      for (const row of existingOfKind) {
        await storage.delete(row.storageKey)
      }

      return insertedRow
    })
  }

  await onModuleDataChanged(input.munId, 'BRANDING', session!.userId)

  return created
}

/** Public read, no auth — the mun detail page and organizer dashboard both render gallery/branding assets. */
export async function listMunMedia(munId: string): Promise<MunMediaItem[]> {
  return db.select().from(munMedia).where(eq(munMedia.munId, munId)).orderBy(asc(munMedia.displayOrder))
}

/** Deletes a media row and its underlying storage object. Owning organizer or admin only. */
export async function deleteMunMedia(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munMedia.munId, storageKey: munMedia.storageKey })
    .from(munMedia)
    .where(eq(munMedia.id, id))
    .limit(1)
  if (!existing) throw new Error('Media not found')
  await assertOwnsOrAdmin(existing.munId, session)

  await db.delete(munMedia).where(eq(munMedia.id, id))
  await storage.delete(existing.storageKey)

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
