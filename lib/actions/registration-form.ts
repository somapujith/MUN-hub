'use server'

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munFormFields } from '@/lib/db/schema'
import type { FormFieldType } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { onModuleDataChanged } from '@/lib/lifecycle/module-completion'

// -----------------------------------------------------------------------------
// registration-form — REGISTRATION_FORM module (PRD Section 17)
// -----------------------------------------------------------------------------
//
// Validation rules that matter here:
//  1. fieldKey is unique per mun. `mun_form_fields_mun_key_uq` (Task 4) backs
//     this at the DB level — we catch the constraint violation on insert/
//     update and rethrow a readable error instead of leaking the raw
//     Postgres error string to the caller.
//  2. DROPDOWN/MULTIPLE_CHOICE/CHECKBOX require a non-empty `choices` array
//     (mirrors the precedent in accommodation.ts's
//     createAccommodationOptionField).
//  3. `conditionalOn`, when set, must reference an existing fieldKey on the
//     SAME mun, and must not create a cycle (see `assertNoConditionalCycle`
//     below — design doc Section 2.3).
//  4. Deleting a field that another field's `conditionalOn` points at is
//     rejected, naming the dependent field(s), rather than silently orphaning
//     the reference.

const CHOICE_FIELD_TYPES: readonly FormFieldType[] = ['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX']

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505'

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') return code
  const cause = (error as { cause?: unknown }).cause
  if (typeof cause === 'object' && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code
    if (typeof causeCode === 'string') return causeCode
  }
  return undefined
}

/**
 * Detects a Postgres unique_violation regardless of whether the driver
 * throws it directly or Drizzle wraps it in a `DrizzleQueryError` with the
 * original `postgres` error on `.cause` (the postgres-js driver's actual
 * behavior against `.returning()` queries).
 */
function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === UNIQUE_VIOLATION
}

export interface FormField {
  id: string
  munId: string
  fieldKey: string
  fieldType: FormFieldType
  label: string
  helpText: string | null
  required: boolean
  choices: unknown
  displayOrder: number
  conditionalOn: string | null
  conditionalOperator: string | null
  conditionalValue: string | null
  createdAt: Date
}

function validateChoices(fieldType: FormFieldType, choices: string[] | null | undefined): void {
  if (CHOICE_FIELD_TYPES.includes(fieldType) && (!choices || choices.length === 0)) {
    throw new Error(`Field type ${fieldType} requires a non-empty choices array`)
  }
}

/**
 * Loads the fieldKey -> conditionalOn map for a mun, used to walk parent
 * chains without re-querying per hop.
 */
async function loadConditionalOnMap(munId: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ fieldKey: munFormFields.fieldKey, conditionalOn: munFormFields.conditionalOn })
    .from(munFormFields)
    .where(eq(munFormFields.munId, munId))

  return new Map(rows.map((row) => [row.fieldKey, row.conditionalOn]))
}

/**
 * Verifies that setting `fieldKey`'s parent to `conditionalOn` does not
 * create a cycle. Walks the parent chain upward from `conditionalOn`; if the
 * walk reaches `fieldKey` itself, that's a cycle. Also verifies
 * `conditionalOn` resolves to an existing fieldKey on `munId`.
 *
 * The walk is bounded by the mun's total field count so a pre-existing
 * corrupt chain (e.g. from manual data surgery) can't cause an infinite
 * loop — it throws a cycle error instead once the bound is exceeded.
 */
export async function assertNoConditionalCycle(munId: string, fieldKey: string, conditionalOn: string): Promise<void> {
  const map = await loadConditionalOnMap(munId)

  if (!map.has(conditionalOn)) {
    throw new Error(`conditionalOn references unknown fieldKey "${conditionalOn}" on this mun`)
  }

  const maxSteps = map.size
  let current: string | null = conditionalOn
  let steps = 0

  while (current !== null) {
    if (current === fieldKey) {
      throw new Error(`conditionalOn on "${fieldKey}" would create a cycle via "${conditionalOn}"`)
    }
    steps += 1
    if (steps > maxSteps) {
      throw new Error(`conditionalOn chain from "${conditionalOn}" exceeds the mun's field count — refusing to walk further (likely corrupt data)`)
    }
    current = map.get(current) ?? null
  }
}

/** Finds field(s) on the same mun whose conditionalOn points at `fieldKey`. */
async function findDependents(munId: string, fieldKey: string): Promise<string[]> {
  const rows = await db
    .select({ fieldKey: munFormFields.fieldKey })
    .from(munFormFields)
    .where(and(eq(munFormFields.munId, munId), eq(munFormFields.conditionalOn, fieldKey)))
  return rows.map((row) => row.fieldKey)
}

export interface CreateFormFieldInput {
  munId: string
  fieldKey: string
  fieldType: FormFieldType
  label: string
  helpText?: string | null
  required?: boolean
  choices?: string[] | null
  displayOrder?: number
  conditionalOn?: string | null
  conditionalOperator?: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | null
  conditionalValue?: string | null
}

export async function createFormField(input: CreateFormFieldInput, session: Session | null): Promise<FormField> {
  await assertOwnsOrAdmin(input.munId, session)
  validateChoices(input.fieldType, input.choices)

  if (input.conditionalOn) {
    await assertNoConditionalCycle(input.munId, input.fieldKey, input.conditionalOn)
  }

  let created: FormField
  try {
    ;[created] = await db
      .insert(munFormFields)
      .values({
        munId: input.munId,
        fieldKey: input.fieldKey,
        fieldType: input.fieldType,
        label: input.label,
        helpText: input.helpText ?? null,
        required: input.required ?? false,
        choices: input.choices ?? null,
        displayOrder: input.displayOrder ?? 0,
        conditionalOn: input.conditionalOn ?? null,
        conditionalOperator: input.conditionalOperator ?? null,
        conditionalValue: input.conditionalValue ?? null,
      })
      .returning()
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`fieldKey "${input.fieldKey}" is already used on this mun — fieldKey must be unique per mun`)
    }
    throw error
  }

  await onModuleDataChanged(input.munId, 'REGISTRATION_FORM', session!.userId)

  return created
}

export interface UpdateFormFieldInput {
  fieldKey?: string
  fieldType?: FormFieldType
  label?: string
  helpText?: string | null
  required?: boolean
  choices?: string[] | null
  displayOrder?: number
  conditionalOn?: string | null
  conditionalOperator?: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | null
  conditionalValue?: string | null
}

export async function updateFormField(id: string, input: UpdateFormFieldInput, session: Session | null): Promise<FormField> {
  const [existing] = await db.select().from(munFormFields).where(eq(munFormFields.id, id)).limit(1)
  if (!existing) throw new Error('Form field not found')
  await assertOwnsOrAdmin(existing.munId, session)

  const effectiveFieldType = input.fieldType ?? existing.fieldType
  const effectiveChoices = input.choices !== undefined ? input.choices : (existing.choices as string[] | null)
  validateChoices(effectiveFieldType, effectiveChoices)

  const effectiveFieldKey = input.fieldKey ?? existing.fieldKey
  if (input.conditionalOn) {
    await assertNoConditionalCycle(existing.munId, effectiveFieldKey, input.conditionalOn)
  }

  let updated: FormField
  try {
    ;[updated] = await db
      .update(munFormFields)
      .set(input)
      .where(eq(munFormFields.id, id))
      .returning()
    if (!updated) throw new Error('Form field not found')
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`fieldKey "${effectiveFieldKey}" is already used on this mun — fieldKey must be unique per mun`)
    }
    throw error
  }

  await onModuleDataChanged(existing.munId, 'REGISTRATION_FORM', session!.userId)

  return updated
}

export async function deleteFormField(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: munFormFields.munId, fieldKey: munFormFields.fieldKey })
    .from(munFormFields)
    .where(eq(munFormFields.id, id))
    .limit(1)
  if (!existing) throw new Error('Form field not found')
  await assertOwnsOrAdmin(existing.munId, session)

  const dependents = await findDependents(existing.munId, existing.fieldKey)
  if (dependents.length > 0) {
    throw new Error(`Cannot delete field "${existing.fieldKey}": referenced by conditionalOn on ${dependents.join(', ')}`)
  }

  await db.delete(munFormFields).where(eq(munFormFields.id, id))

  await onModuleDataChanged(existing.munId, 'REGISTRATION_FORM', session!.userId)
}

export interface ReorderFormFieldsInput {
  munId: string
  order: Array<{ id: string; displayOrder: number }>
}

/**
 * Bulk-updates `displayOrder` for a set of fields on one mun. Each id in
 * `order` must belong to `munId` — an id from another mun is rejected
 * (IDOR), rather than silently reordering a stranger's field.
 */
export async function reorderFormFields(input: ReorderFormFieldsInput, session: Session | null): Promise<FormField[]> {
  await assertOwnsOrAdmin(input.munId, session)

  const existing = await db
    .select({ id: munFormFields.id, munId: munFormFields.munId })
    .from(munFormFields)
    .where(eq(munFormFields.munId, input.munId))

  const validIds = new Set(existing.map((row) => row.id))
  for (const { id } of input.order) {
    if (!validIds.has(id)) {
      throw new Error(`Field ${id} does not belong to mun ${input.munId}`)
    }
  }

  await db.transaction(async (tx) => {
    for (const { id, displayOrder } of input.order) {
      await tx
        .update(munFormFields)
        .set({ displayOrder })
        .where(and(eq(munFormFields.id, id), eq(munFormFields.munId, input.munId)))
    }
  })

  await onModuleDataChanged(input.munId, 'REGISTRATION_FORM', session!.userId)

  return listFormFields(input.munId)
}

/** Public read, no auth — the registration funnel renders these to build the form. */
export async function listFormFields(munId: string): Promise<FormField[]> {
  return db
    .select()
    .from(munFormFields)
    .where(eq(munFormFields.munId, munId))
    .orderBy(asc(munFormFields.displayOrder))
}
