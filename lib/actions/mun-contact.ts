import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munContacts } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'

// -----------------------------------------------------------------------------
// mun-contact — CONTACT module (PRD Section 23)
// -----------------------------------------------------------------------------
//
// One row per mun. `munContacts.munId` is UNIQUE (Task 4), so the upsert
// uses `onConflictDoUpdate` against that constraint rather than a
// read-then-write pattern — the latter has a TOCTOU race between the read
// and the write that the DB constraint + onConflict clause avoids entirely.
//
// CONTACT is a high-impact module (Task 12) — the upsert calls
// `assertModuleNotLocked` right after the ownership check.

export interface MunContact {
  id: string
  munId: string
  officialEmail: string
  phone: string | null
  website: string | null
  socialLinks: unknown
  contactPersonName: string
  contactPersonRole: string | null
  contactPersonEmail: string
  contactPersonPhone: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UpsertMunContactInput {
  officialEmail: string
  phone?: string | null
  website?: string | null
  socialLinks?: unknown
  contactPersonName: string
  contactPersonRole?: string | null
  contactPersonEmail: string
  contactPersonPhone?: string | null
}

/** Creates or replaces the mun's single contact row. Owning organizer or admin only. */
export async function upsertMunContact(
  munId: string,
  input: UpsertMunContactInput,
  session: Session | null,
): Promise<MunContact> {
  await assertOwnsOrAdmin(munId, session)
  await assertModuleNotLocked(munId, 'CONTACT', session)

  const values = {
    munId,
    officialEmail: input.officialEmail,
    phone: input.phone ?? null,
    website: input.website ?? null,
    socialLinks: input.socialLinks ?? null,
    contactPersonName: input.contactPersonName,
    contactPersonRole: input.contactPersonRole ?? null,
    contactPersonEmail: input.contactPersonEmail,
    contactPersonPhone: input.contactPersonPhone ?? null,
    updatedAt: new Date(),
  }

  const [result] = await db
    .insert(munContacts)
    .values(values)
    .onConflictDoUpdate({
      target: munContacts.munId,
      set: values,
    })
    .returning()

  await onModuleDataChanged(munId, 'CONTACT', session!.userId)

  return result
}

/** Public read, no auth — the mun detail page renders contact info. */
export async function getMunContact(munId: string): Promise<MunContact | null> {
  const [contact] = await db.select().from(munContacts).where(eq(munContacts.munId, munId)).limit(1)
  return contact ?? null
}
