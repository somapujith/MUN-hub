import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munDocuments } from '@/lib/db/schema'
import type { MunDocumentKind } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { mockStorageAdapter } from '@/lib/storage/mock-adapter'
import type { StorageAdapter } from '@/lib/storage/adapter'

// -----------------------------------------------------------------------------
// mun-documents — RULES_DOCUMENTS module (PRD Section 20)
// -----------------------------------------------------------------------------
//
// Same upload pattern as mun-branding.ts: validate content-type + size in
// this file, before touching storage; storage key is always a server-
// generated UUID under muns/{munId}/documents/, never derived from the
// caller-supplied filename.
//
// RULES_DOCUMENTS is a high-impact module (Task 12) — every mutation here
// calls `assertModuleNotLocked` right after the ownership check.

const storage: StorageAdapter = mockStorageAdapter

const ALLOWED_CONTENT_TYPE = 'application/pdf'
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

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

function validateUpload(file: Buffer, contentType: string): void {
  if (contentType !== ALLOWED_CONTENT_TYPE) {
    throw new Error(`Unsupported content type "${contentType}" — only application/pdf is allowed`)
  }
  if (file.byteLength > MAX_SIZE_BYTES) {
    throw new Error(`File too large (${file.byteLength} bytes) — maximum allowed size is 20MB`)
  }
}

/** Uploads a rules/policy document. Validates content-type and size BEFORE touching storage. */
export async function uploadMunDocument(
  input: UploadMunDocumentInput,
  session: Session | null,
): Promise<MunDocumentItem> {
  await assertOwnsOrAdmin(input.munId, session)
  await assertModuleNotLocked(input.munId, 'RULES_DOCUMENTS', session)
  validateUpload(input.file, input.contentType)

  const key = `muns/${input.munId}/documents/${crypto.randomUUID()}`
  const { url } = await storage.upload(input.file, key, input.contentType)

  const [created] = await db
    .insert(munDocuments)
    .values({
      munId: input.munId,
      kind: input.kind,
      title: input.title,
      url,
      storageKey: key,
      contentType: input.contentType,
      sizeBytes: input.file.byteLength,
    })
    .returning()

  await onModuleDataChanged(input.munId, 'RULES_DOCUMENTS', session!.userId)

  return created
}

/** Public read, no auth — the mun detail page renders published documents. */
export async function listMunDocuments(munId: string): Promise<MunDocumentItem[]> {
  return db.select().from(munDocuments).where(eq(munDocuments.munId, munId))
}

/** Deletes a document row and its underlying storage object. Owning organizer or admin only. */
export async function deleteMunDocument(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munDocuments.munId, storageKey: munDocuments.storageKey })
    .from(munDocuments)
    .where(eq(munDocuments.id, id))
    .limit(1)
  if (!existing) throw new Error('Document not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'RULES_DOCUMENTS', session)

  await db.delete(munDocuments).where(eq(munDocuments.id, id))
  await storage.delete(existing.storageKey)

  await onModuleDataChanged(existing.munId, 'RULES_DOCUMENTS', session!.userId)
}
