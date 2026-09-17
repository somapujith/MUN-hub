import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munDocuments, muns } from '@/lib/db/schema'
import type { MunDocumentKind } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { triggerReverificationIfNeeded } from '@/lib/lifecycle/reverification'
import { assertCanUploadToMun, assertUploadQuota } from '@/lib/actions/upload-limits'
import { deleteStoredObjectQuietly, selectStorageAdapter } from '@/lib/storage/select-adapter'
import { validateUpload } from '@/lib/storage/validate'

// -----------------------------------------------------------------------------
// mun-documents — RULES_DOCUMENTS module (PRD Section 20)
// -----------------------------------------------------------------------------
//
// Same upload pattern as mun-branding.ts: validate content type, size and
// file signature (lib/storage/validate.ts) before touching storage; storage
// key is always a server-generated UUID under muns/{munId}/documents/, never
// derived from the caller-supplied filename. Storage comes from
// selectStorageAdapter() on every call (R2/KV in production, the filesystem
// in local dev, the mock in tests).
//
// RULES_DOCUMENTS is a high-impact module (Task 12) — every mutation here
// calls `assertModuleNotLocked` right after the ownership check.
//
// Documents are never edited in place, so "replacing a policy doc" is an
// upload or a delete. Uploading or deleting a POLICY document (the rules and
// terms delegates agree to) on a verified or live mun sends it back to
// review (`triggerReverificationIfNeeded`, same transaction as the row
// write). Informational documents (brochure, handbook, guides, position
// papers) are routinely added after launch and don't.
const POLICY_DOCUMENT_KINDS: readonly MunDocumentKind[] = ['RULES', 'CODE_OF_CONDUCT', 'REFUND_POLICY']

function isPolicyDocument(kind: MunDocumentKind): boolean {
  return POLICY_DOCUMENT_KINDS.includes(kind)
}

export interface MunDocumentItem {
  id: string
  munId: string
  kind: MunDocumentKind
  title: string
  url: string
  storageKey: string
  contentType: string
  sizeBytes: number
  createdAt: Date
}

export interface UploadMunDocumentInput {
  munId: string
  kind: MunDocumentKind
  title: string
  file: Buffer
  contentType: string
}

/** Uploads a rules/policy document. Validates type, size and contents BEFORE touching storage. */
export async function uploadMunDocument(
  input: UploadMunDocumentInput,
  session: Session | null,
): Promise<MunDocumentItem> {
  await assertCanUploadToMun(input.munId, session)
  await assertModuleNotLocked(input.munId, 'RULES_DOCUMENTS', session)
  validateUpload(input.file, input.contentType, 'DOCUMENT')

  const newBytes = input.file.byteLength
  // Early refusal, before any bytes are written; re-checked under the lock below.
  await assertUploadQuota(db, input.munId, { area: 'documents' }, newBytes)

  const storage = selectStorageAdapter()
  const key = `muns/${input.munId}/documents/${crypto.randomUUID()}`
  const { url } = await storage.upload(input.file, key, input.contentType)

  let created: MunDocumentItem
  try {
    created = await db.transaction(async (tx) => {
      await tx.select({ id: muns.id }).from(muns).where(eq(muns.id, input.munId)).for('update')
      await assertUploadQuota(tx, input.munId, { area: 'documents' }, newBytes)
      const [row] = await tx
        .insert(munDocuments)
        .values({
          munId: input.munId,
          kind: input.kind,
          title: input.title,
          url,
          storageKey: key,
          contentType: input.contentType,
          sizeBytes: newBytes,
        })
        .returning()
      if (isPolicyDocument(row.kind)) {
        await triggerReverificationIfNeeded('RULES_DOCUMENTS', {}, { url: row.url }, input.munId, session!.userId, tx)
      }
      return row
    })
  } catch (error) {
    // No row points at the new object, so don't leave it behind.
    await deleteStoredObjectQuietly(storage, key, 'uploadMunDocument rollback')
    throw error
  }

  await onModuleDataChanged(input.munId, 'RULES_DOCUMENTS', session!.userId)

  return created
}

/** Public read, no auth — the mun detail page renders published documents. */
export async function listMunDocuments(munId: string): Promise<MunDocumentItem[]> {
  return db.select().from(munDocuments).where(eq(munDocuments.munId, munId))
}

/**
 * Deletes a document row, then its storage object. Owning organizer or
 * admin only. The object delete is best effort: once the row is gone the
 * file is no longer listed anywhere, so a storage failure is logged instead
 * of failing the request.
 */
export async function deleteMunDocument(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munDocuments.munId, storageKey: munDocuments.storageKey, kind: munDocuments.kind, url: munDocuments.url })
    .from(munDocuments)
    .where(eq(munDocuments.id, id))
    .limit(1)
  if (!existing) throw new Error('Document not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'RULES_DOCUMENTS', session)

  await db.transaction(async (tx) => {
    await tx.delete(munDocuments).where(eq(munDocuments.id, id))
    if (isPolicyDocument(existing.kind)) {
      await triggerReverificationIfNeeded(
        'RULES_DOCUMENTS',
        { url: existing.url },
        { url: null },
        existing.munId,
        session!.userId,
        tx,
      )
    }
  })
  await deleteStoredObjectQuietly(selectStorageAdapter, existing.storageKey, 'deleteMunDocument')

  await onModuleDataChanged(existing.munId, 'RULES_DOCUMENTS', session!.userId)
}
