import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, munExecutiveBoard } from '@/lib/db/schema'
import type { EbRole } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { FILES_ROUTE_PREFIX, isSafeStorageKey } from '@/lib/storage/keys'
import { deleteStoredObjectQuietly, selectStorageAdapter } from '@/lib/storage/select-adapter'
import { validateUpload } from '@/lib/storage/validate'

// -----------------------------------------------------------------------------
// executive-board — EXECUTIVE_BOARD module (PRD Section 14)
// -----------------------------------------------------------------------------
//
// Two validation rules matter here:
//  1. role === 'CUSTOM' requires a non-empty customRole.
//  2. committeeId, when provided, must belong to the SAME mun as munId — an
//     IDOR check. Without this, an organizer of mun A could attach an EB
//     member to a committee belonging to mun B by supplying that committee's
//     id, since committeeId alone doesn't prove same-mun ownership.
//
// EXECUTIVE_BOARD is a high-impact module (Task 12) — every mutation here
// calls `assertModuleNotLocked` right after the ownership check, before any
// row is touched.

export interface ExecutiveBoardMember {
  id: string
  munId: string
  committeeId: string | null
  name: string
  role: EbRole
  customRole: string | null
  photoUrl: string | null
  bio: string | null
  institution: string | null
  organization: string | null
  socialLinks: unknown
  isPublic: boolean
  displayOrder: number
  createdAt: Date
}

function validateRole(role: EbRole, customRole: string | null | undefined): void {
  if (role === 'CUSTOM' && (!customRole || customRole.trim().length === 0)) {
    throw new Error('customRole is required when role is CUSTOM')
  }
}

/**
 * Verifies `committeeId` (if provided) belongs to `munId`. Throws
 * `Error('Committee not found')` if the id doesn't resolve, and
 * `Error('Forbidden')` if it resolves to a committee under a different mun
 * — a cross-mun committee id must never be silently accepted (IDOR).
 */
async function assertCommitteeBelongsToMun(committeeId: string | null | undefined, munId: string): Promise<void> {
  if (!committeeId) return
  const [committee] = await db
    .select({ munId: committees.munId })
    .from(committees)
    .where(eq(committees.id, committeeId))
    .limit(1)
  if (!committee) throw new Error('Committee not found')
  if (committee.munId !== munId) throw new Error('Forbidden')
}

export interface CreateEbMemberInput {
  munId: string
  committeeId?: string | null
  name: string
  role: EbRole
  customRole?: string | null
  photoUrl?: string | null
  bio?: string | null
  institution?: string | null
  organization?: string | null
  socialLinks?: unknown
  isPublic?: boolean
  displayOrder?: number
}

export async function createEbMember(input: CreateEbMemberInput, session: Session | null): Promise<ExecutiveBoardMember> {
  await assertOwnsOrAdmin(input.munId, session)
  await assertModuleNotLocked(input.munId, 'EXECUTIVE_BOARD', session)
  validateRole(input.role, input.customRole)
  await assertCommitteeBelongsToMun(input.committeeId, input.munId)

  const [created] = await db
    .insert(munExecutiveBoard)
    .values({
      munId: input.munId,
      committeeId: input.committeeId ?? null,
      name: input.name,
      role: input.role,
      customRole: input.role === 'CUSTOM' ? (input.customRole ?? null) : null,
      photoUrl: input.photoUrl ?? null,
      bio: input.bio ?? null,
      institution: input.institution ?? null,
      organization: input.organization ?? null,
      socialLinks: input.socialLinks ?? null,
      isPublic: input.isPublic ?? true,
      displayOrder: input.displayOrder ?? 0,
    })
    .returning()

  await onModuleDataChanged(input.munId, 'EXECUTIVE_BOARD', session!.userId)

  return created
}

export interface UpdateEbMemberInput {
  committeeId?: string | null
  name?: string
  role?: EbRole
  customRole?: string | null
  photoUrl?: string | null
  bio?: string | null
  institution?: string | null
  organization?: string | null
  socialLinks?: unknown
  isPublic?: boolean
  displayOrder?: number
}

export async function updateEbMember(
  id: string,
  input: UpdateEbMemberInput,
  session: Session | null,
): Promise<ExecutiveBoardMember> {
  const [existing] = await db
    .select()
    .from(munExecutiveBoard)
    .where(eq(munExecutiveBoard.id, id))
    .limit(1)
  if (!existing) throw new Error('Executive board member not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'EXECUTIVE_BOARD', session)

  const effectiveRole = input.role ?? existing.role
  const effectiveCustomRole = input.customRole !== undefined ? input.customRole : existing.customRole
  validateRole(effectiveRole, effectiveCustomRole)

  if (input.committeeId !== undefined) {
    await assertCommitteeBelongsToMun(input.committeeId, existing.munId)
  }

  const [updated] = await db
    .update(munExecutiveBoard)
    .set({
      ...input,
      customRole: effectiveRole === 'CUSTOM' ? effectiveCustomRole : null,
    })
    .where(eq(munExecutiveBoard.id, id))
    .returning()
  if (!updated) throw new Error('Executive board member not found')

  await onModuleDataChanged(existing.munId, 'EXECUTIVE_BOARD', session!.userId)

  return updated
}

export async function deleteEbMember(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munExecutiveBoard.munId, photoUrl: munExecutiveBoard.photoUrl })
    .from(munExecutiveBoard)
    .where(eq(munExecutiveBoard.id, id))
    .limit(1)
  if (!existing) throw new Error('Executive board member not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'EXECUTIVE_BOARD', session)

  await db.delete(munExecutiveBoard).where(eq(munExecutiveBoard.id, id))
  await deleteUploadedPhoto(existing.munId, existing.photoUrl)

  await onModuleDataChanged(existing.munId, 'EXECUTIVE_BOARD', session!.userId)
}

// -----------------------------------------------------------------------------
// Member photos
// -----------------------------------------------------------------------------
//
// Organizers upload a photo file instead of pasting a link. Stored under
// `muns/<munId>/board/<uuid>` with the same checks as branding images; the
// member's `photoUrl` points at it. A pasted external link still works.

const boardPhotoPrefix = (munId: string) => `muns/${munId}/board/`

/** The storage key behind `photoUrl` when it's a photo uploaded for this MUN, else null. */
function uploadedPhotoKey(munId: string, photoUrl: string | null): string | null {
  if (!photoUrl) return null
  const at = photoUrl.indexOf(FILES_ROUTE_PREFIX)
  if (at < 0) return null
  const key = photoUrl
    .slice(at + FILES_ROUTE_PREFIX.length)
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
  return key.startsWith(boardPhotoPrefix(munId)) && isSafeStorageKey(key) ? key : null
}

async function deleteUploadedPhoto(munId: string, photoUrl: string | null): Promise<void> {
  const key = uploadedPhotoKey(munId, photoUrl)
  if (key) await deleteStoredObjectQuietly(selectStorageAdapter(), key, 'executive board photo')
}

async function loadMemberForPhoto(id: string, session: Session | null) {
  const [existing] = await db
    .select({ munId: munExecutiveBoard.munId, photoUrl: munExecutiveBoard.photoUrl })
    .from(munExecutiveBoard)
    .where(eq(munExecutiveBoard.id, id))
    .limit(1)
  if (!existing) throw new Error('Executive board member not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'EXECUTIVE_BOARD', session)
  return existing
}

/**
 * Uploads a board member's photo and points `photoUrl` at it, replacing (and
 * deleting) a previously uploaded one. Type, size and contents are checked
 * before storage is touched.
 */
export async function uploadEbMemberPhoto(
  id: string,
  file: Buffer,
  contentType: string,
  session: Session | null,
): Promise<ExecutiveBoardMember> {
  const existing = await loadMemberForPhoto(id, session)
  validateUpload(file, contentType, 'IMAGE')

  const storage = selectStorageAdapter()
  const key = `${boardPhotoPrefix(existing.munId)}${crypto.randomUUID()}`
  const { url } = await storage.upload(file, key, contentType)

  let updated: ExecutiveBoardMember | undefined
  try {
    ;[updated] = await db.update(munExecutiveBoard).set({ photoUrl: url }).where(eq(munExecutiveBoard.id, id)).returning()
  } catch (error) {
    await deleteStoredObjectQuietly(storage, key, 'executive board photo rollback')
    throw error
  }
  if (!updated) {
    await deleteStoredObjectQuietly(storage, key, 'executive board photo rollback')
    throw new Error('Executive board member not found')
  }

  await deleteUploadedPhoto(existing.munId, existing.photoUrl)
  await onModuleDataChanged(existing.munId, 'EXECUTIVE_BOARD', session!.userId)
  return updated
}

/** Clears a board member's photo, deleting it from storage if it was uploaded. */
export async function removeEbMemberPhoto(id: string, session: Session | null): Promise<ExecutiveBoardMember> {
  const existing = await loadMemberForPhoto(id, session)
  const [updated] = await db.update(munExecutiveBoard).set({ photoUrl: null }).where(eq(munExecutiveBoard.id, id)).returning()
  if (!updated) throw new Error('Executive board member not found')
  await deleteUploadedPhoto(existing.munId, existing.photoUrl)
  await onModuleDataChanged(existing.munId, 'EXECUTIVE_BOARD', session!.userId)
  return updated
}

/** Public read, no auth — the mun detail page renders the executive board. */
export async function listEbMembers(munId: string): Promise<ExecutiveBoardMember[]> {
  return db
    .select()
    .from(munExecutiveBoard)
    .where(and(eq(munExecutiveBoard.munId, munId), eq(munExecutiveBoard.isPublic, true)))
    .orderBy(asc(munExecutiveBoard.displayOrder))
}

/** Organizer read, includes hidden members so they can be edited or published. */
export async function listEbMembersForOrganizer(munId: string, session: Session | null): Promise<ExecutiveBoardMember[]> {
  await assertOwnsOrAdmin(munId, session)
  return db.select().from(munExecutiveBoard).where(eq(munExecutiveBoard.munId, munId)).orderBy(asc(munExecutiveBoard.displayOrder))
}
