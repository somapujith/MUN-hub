'use server'

import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, munExecutiveBoard } from '@/lib/db/schema'
import type { EbRole } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { onModuleDataChanged } from '@/lib/lifecycle/module-completion'

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

export interface ExecutiveBoardMember {
  id: string
  munId: string
  committeeId: string | null
  name: string
  role: EbRole
  customRole: string | null
  photoUrl: string | null
  bio: string | null
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
  displayOrder?: number
}

export async function createEbMember(input: CreateEbMemberInput, session: Session | null): Promise<ExecutiveBoardMember> {
  await assertOwnsOrAdmin(input.munId, session)
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
    .select({ munId: munExecutiveBoard.munId })
    .from(munExecutiveBoard)
    .where(eq(munExecutiveBoard.id, id))
    .limit(1)
  if (!existing) throw new Error('Executive board member not found')
  await assertOwnsOrAdmin(existing.munId, session)

  await db.delete(munExecutiveBoard).where(eq(munExecutiveBoard.id, id))

  await onModuleDataChanged(existing.munId, 'EXECUTIVE_BOARD', session!.userId)
}

/** Public read, no auth — the mun detail page renders the executive board. */
export async function listEbMembers(munId: string): Promise<ExecutiveBoardMember[]> {
  return db
    .select()
    .from(munExecutiveBoard)
    .where(eq(munExecutiveBoard.munId, munId))
    .orderBy(asc(munExecutiveBoard.displayOrder))
}
