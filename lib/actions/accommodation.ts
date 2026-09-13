'use server'

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accommodationOptionFields, accommodationOptions, muns } from '@/lib/db/schema'
import type { AccommodationFieldType } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'

/**
 * Same ownership rule as mun-config.ts: the acting session must be the
 * owning organizer of the mun, or ADMIN/SUPER_ADMIN.
 */
async function assertOwnsOrAdmin(munId: string, session: Session | null): Promise<void> {
  if (!session) throw new Error('Forbidden')
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') return

  const [mun] = await db.select({ organizerId: muns.organizerId }).from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')

  if (mun.organizerId !== session.userId) {
    throw new Error('Forbidden')
  }
}

async function getMunIdForOption(optionId: string): Promise<string> {
  const [option] = await db
    .select({ munId: accommodationOptions.munId })
    .from(accommodationOptions)
    .where(eq(accommodationOptions.id, optionId))
    .limit(1)
  if (!option) throw new Error('Accommodation option not found')
  return option.munId
}

// -----------------------------------------------------------------------------
// Accommodation options
// -----------------------------------------------------------------------------

export interface AccommodationOption {
  id: string
  munId: string
  name: string
  price: number
  capacity: number
  description: string | null
  status: string
  createdAt: Date
}

export interface CreateAccommodationOptionInput {
  munId: string
  name: string
  price: number
  capacity: number
  description?: string
}

export async function createAccommodationOption(
  input: CreateAccommodationOptionInput,
  session: Session | null,
): Promise<AccommodationOption> {
  await assertOwnsOrAdmin(input.munId, session)
  const [option] = await db.insert(accommodationOptions).values(input).returning()
  return option
}

export interface UpdateAccommodationOptionInput {
  name?: string
  price?: number
  capacity?: number
  description?: string | null
  status?: string
}

export async function updateAccommodationOption(
  id: string,
  input: UpdateAccommodationOptionInput,
  session: Session | null,
): Promise<AccommodationOption> {
  const munId = await getMunIdForOption(id)
  await assertOwnsOrAdmin(munId, session)

  const [updated] = await db
    .update(accommodationOptions)
    .set(input)
    .where(eq(accommodationOptions.id, id))
    .returning()
  if (!updated) throw new Error('Accommodation option not found')
  return updated
}

/**
 * SOFT-DELETE, same reasoning as `deleteRegistrationProduct` in mun-config.ts:
 * a registration may already reference this option via
 * `registrations.accommodationOptionId`, and a hard delete would either
 * violate that FK or (if cascaded) silently destroy paid registration
 * history. Flip `status` to 'inactive' instead.
 */
export async function deleteAccommodationOption(id: string, session: Session | null): Promise<void> {
  const munId = await getMunIdForOption(id)
  await assertOwnsOrAdmin(munId, session)

  await db.update(accommodationOptions).set({ status: 'inactive' }).where(eq(accommodationOptions.id, id))
}

/**
 * Public read, no auth — used by the registration funnel's accommodation
 * step and the organizer dashboard.
 *
 * Defaults to active-only: a caller that forgets to filter would otherwise
 * expose archived (soft-deleted) options — the registration funnel already
 * filters client-side as a defense-in-depth measure, but that shouldn't be
 * the only thing preventing it. Pass `includeInactive: true` explicitly for
 * admin/organizer views that need to show archived options (e.g. with a
 * "restore" action).
 */
export async function listAccommodationOptions(
  munId: string,
  options: { includeInactive?: boolean } = {},
): Promise<AccommodationOption[]> {
  return db
    .select()
    .from(accommodationOptions)
    .where(
      options.includeInactive
        ? eq(accommodationOptions.munId, munId)
        : and(eq(accommodationOptions.munId, munId), eq(accommodationOptions.status, 'active')),
    )
}

// -----------------------------------------------------------------------------
// Accommodation option custom fields
// -----------------------------------------------------------------------------

export interface AccommodationOptionField {
  id: string
  optionId: string
  fieldType: AccommodationFieldType
  label: string
  required: boolean
  choices: unknown
  displayOrder: number
}

export interface CreateAccommodationOptionFieldInput {
  optionId: string
  fieldType: AccommodationFieldType
  label: string
  required?: boolean
  choices?: string[]
  displayOrder?: number
}

export async function createAccommodationOptionField(
  input: CreateAccommodationOptionFieldInput,
  session: Session | null,
): Promise<AccommodationOptionField> {
  const munId = await getMunIdForOption(input.optionId)
  await assertOwnsOrAdmin(munId, session)

  if ((input.fieldType === 'DROPDOWN' || input.fieldType === 'CHECKBOX') && (!input.choices || input.choices.length === 0)) {
    throw new Error(`Field type ${input.fieldType} requires at least one choice`)
  }

  const [field] = await db.insert(accommodationOptionFields).values(input).returning()
  return field
}

export interface UpdateAccommodationOptionFieldInput {
  fieldType?: AccommodationFieldType
  label?: string
  required?: boolean
  choices?: string[] | null
  displayOrder?: number
}

export async function updateAccommodationOptionField(
  id: string,
  input: UpdateAccommodationOptionFieldInput,
  session: Session | null,
): Promise<AccommodationOptionField> {
  const [existing] = await db
    .select({ optionId: accommodationOptionFields.optionId })
    .from(accommodationOptionFields)
    .where(eq(accommodationOptionFields.id, id))
    .limit(1)
  if (!existing) throw new Error('Accommodation field not found')

  const munId = await getMunIdForOption(existing.optionId)
  await assertOwnsOrAdmin(munId, session)

  const [updated] = await db
    .update(accommodationOptionFields)
    .set(input)
    .where(eq(accommodationOptionFields.id, id))
    .returning()
  if (!updated) throw new Error('Accommodation field not found')
  return updated
}

/** Hard-deletes a field definition — no financial record depends on a field row continuing to exist. */
export async function deleteAccommodationOptionField(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ optionId: accommodationOptionFields.optionId })
    .from(accommodationOptionFields)
    .where(eq(accommodationOptionFields.id, id))
    .limit(1)
  if (!existing) throw new Error('Accommodation field not found')

  const munId = await getMunIdForOption(existing.optionId)
  await assertOwnsOrAdmin(munId, session)

  await db.delete(accommodationOptionFields).where(eq(accommodationOptionFields.id, id))
}

/** Public read, no auth — the registration funnel renders these to compose the accommodation step's form. */
export async function listAccommodationOptionFields(optionId: string): Promise<AccommodationOptionField[]> {
  return db
    .select()
    .from(accommodationOptionFields)
    .where(eq(accommodationOptionFields.optionId, optionId))
    .orderBy(asc(accommodationOptionFields.displayOrder))
}
