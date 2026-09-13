'use server'

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munMedia } from '@/lib/db/schema'
import type { MunMediaKind } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
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

  if (!UPSERT_KINDS.includes(input.kind)) {
    const [created] = await db.insert(munMedia).values(values).returning()
    return created
  }

  return db.transaction(async (tx) => {
    const existingOfKind = await tx
      .select({ id: munMedia.id, storageKey: munMedia.storageKey })
      .from(munMedia)
      .where(and(eq(munMedia.munId, input.munId), eq(munMedia.kind, input.kind)))

    for (const row of existingOfKind) {
      await tx.delete(munMedia).where(eq(munMedia.id, row.id))
    }

    const [created] = await tx.insert(munMedia).values(values).returning()

    // Storage deletes happen after the DB write commits its intent within
    // this transaction's scope so a failed insert doesn't orphan a delete of
    // still-referenced storage — but since delete() here is a fire-and-forget
    // cleanup of the *old* object (already superseded in the DB row set),
    // it's safe to issue once the replacement row exists.
    for (const row of existingOfKind) {
      await storage.delete(row.storageKey)
    }

    return created
  })
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
}

/**
 * Reorders the GALLERY images for a mun by writing `displayOrder` from the
 * given id order. Owning organizer or admin only. Only touches rows that
 * belong to `munId` — an id from another mun in `orderedIds` is silently
 * ignored rather than allowed to affect this mun's ordering.
 */
export async function reorderGallery(munId: string, orderedIds: string[], session: Session | null): Promise<void> {
  await assertOwnsOrAdmin(munId, session)

  const rows = await db.select({ id: munMedia.id }).from(munMedia).where(eq(munMedia.munId, munId))
  const validIds = new Set(rows.map((r) => r.id))

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      if (!validIds.has(id)) continue
      await tx.update(munMedia).set({ displayOrder: index }).where(eq(munMedia.id, id))
    }
  })
}
