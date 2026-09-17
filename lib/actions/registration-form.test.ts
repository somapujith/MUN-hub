import { eq, and } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munFormFields, munModuleVerifications, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import {
  assertNoConditionalCycle,
  createFormField,
  deleteFormField,
  listFormFields,
  listFormFieldsForOrganizer,
  reorderFormFields,
  updateFormField,
} from './registration-form'
import { DEFAULT_REGISTRATION_FIELDS } from './registration-form-defaults'

const DEFAULT_KEYS = new Set(DEFAULT_REGISTRATION_FIELDS.map((f) => f.fieldKey))

async function storedRowCount(munId: string): Promise<number> {
  const rows = await db.select({ id: munFormFields.id }).from(munFormFields).where(eq(munFormFields.munId, munId))
  return rows.length
}

async function makeUser(role: 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, overrides: Partial<typeof muns.$inferInsert> = {}) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Form Mun',
      slug: `form-mun-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('registration-form actions', () => {
  describe('createFormField', () => {
    it('lets the owning organizer create a field', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const field = await createFormField(
        { munId: mun.id, fieldKey: 'full_name', fieldType: 'SHORT_TEXT', label: 'Full Name' },
        session,
      )

      expect(field.munId).toBe(mun.id)
      expect(field.fieldKey).toBe('full_name')
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        createFormField({ munId: mun.id, fieldKey: 'x', fieldType: 'SHORT_TEXT', label: 'X' }, sessionFor(stranger)),
      ).rejects.toThrow('Forbidden')
    })

    it('rejects a duplicate fieldKey on the same mun with a readable error', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: mun.id, fieldKey: 'dup_key', fieldType: 'SHORT_TEXT', label: 'First' }, session)

      await expect(
        createFormField({ munId: mun.id, fieldKey: 'dup_key', fieldType: 'SHORT_TEXT', label: 'Second' }, session),
      ).rejects.toThrow(/fieldKey.*unique/i)
    })

    it('allows the same fieldKey on two different muns', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: munA.id, fieldKey: 'shared_key', fieldType: 'SHORT_TEXT', label: 'A' }, session)
      const fieldB = await createFormField(
        { munId: munB.id, fieldKey: 'shared_key', fieldType: 'SHORT_TEXT', label: 'B' },
        session,
      )
      expect(fieldB.munId).toBe(munB.id)
    })

    it.each(['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'] as const)(
      'rejects %s with no choices array',
      async (fieldType) => {
        const organizer = await makeUser('ORGANIZER')
        const mun = await makeMun(organizer.id)
        const session = sessionFor(organizer)

        await expect(
          createFormField({ munId: mun.id, fieldKey: `f_${fieldType}`, fieldType, label: 'Choice field' }, session),
        ).rejects.toThrow(/requires a non-empty choices array/)
      },
    )

    it.each(['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'] as const)(
      'accepts %s with a non-empty choices array',
      async (fieldType) => {
        const organizer = await makeUser('ORGANIZER')
        const mun = await makeMun(organizer.id)
        const session = sessionFor(organizer)

        const field = await createFormField(
          { munId: mun.id, fieldKey: `f_ok_${fieldType}`, fieldType, label: 'Choice field', choices: ['A', 'B'] },
          session,
        )
        expect(field.choices).toEqual(['A', 'B'])
      },
    )

    it('rejects an empty choices array for CHECKBOX', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await expect(
        createFormField(
          { munId: mun.id, fieldKey: 'empty_choices', fieldType: 'CHECKBOX', label: 'X', choices: [] },
          session,
        ),
      ).rejects.toThrow(/requires a non-empty choices array/)
    })

    it('accepts conditionalOn referencing an existing fieldKey on the same mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField(
        { munId: mun.id, fieldKey: 'accommodation', fieldType: 'DROPDOWN', label: 'Need accommodation?', choices: ['Yes', 'No'] },
        session,
      )

      const dependent = await createFormField(
        {
          munId: mun.id,
          fieldKey: 'hotel_pref',
          fieldType: 'SHORT_TEXT',
          label: 'Hotel preference',
          conditionalOn: 'accommodation',
          conditionalOperator: 'EQUALS',
          conditionalValue: 'Yes',
        },
        session,
      )
      expect(dependent.conditionalOn).toBe('accommodation')
    })

    it('rejects conditionalOn referencing a fieldKey that does not exist on the mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await expect(
        createFormField(
          { munId: mun.id, fieldKey: 'orphan', fieldType: 'SHORT_TEXT', label: 'Orphan', conditionalOn: 'nonexistent' },
          session,
        ),
      ).rejects.toThrow(/unknown fieldKey/)
    })

    it('rejects conditionalOn referencing a fieldKey that exists only on a different mun (IDOR)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: munB.id, fieldKey: 'b_field', fieldType: 'SHORT_TEXT', label: 'B field' }, session)

      await expect(
        createFormField(
          { munId: munA.id, fieldKey: 'a_field', fieldType: 'SHORT_TEXT', label: 'A field', conditionalOn: 'b_field' },
          session,
        ),
      ).rejects.toThrow(/unknown fieldKey/)
    })
  })

  describe('assertNoConditionalCycle', () => {
    it('rejects a direct cycle (A depends on B, B set to depend on A)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: mun.id, fieldKey: 'field_a', fieldType: 'SHORT_TEXT', label: 'A' }, session)
      await createFormField(
        { munId: mun.id, fieldKey: 'field_b', fieldType: 'SHORT_TEXT', label: 'B', conditionalOn: 'field_a' },
        session,
      )

      await expect(assertNoConditionalCycle(mun.id, 'field_a', 'field_b')).rejects.toThrow(/cycle/)
    })

    it('rejects a transitive cycle (A -> B -> C, then C set to depend on A)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: mun.id, fieldKey: 'a', fieldType: 'SHORT_TEXT', label: 'A' }, session)
      await createFormField({ munId: mun.id, fieldKey: 'b', fieldType: 'SHORT_TEXT', label: 'B', conditionalOn: 'a' }, session)
      await createFormField({ munId: mun.id, fieldKey: 'c', fieldType: 'SHORT_TEXT', label: 'C', conditionalOn: 'b' }, session)

      await expect(assertNoConditionalCycle(mun.id, 'a', 'c')).rejects.toThrow(/cycle/)
    })

    it('accepts a valid non-cyclic chain', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: mun.id, fieldKey: 'p', fieldType: 'SHORT_TEXT', label: 'P' }, session)
      await createFormField({ munId: mun.id, fieldKey: 'q', fieldType: 'SHORT_TEXT', label: 'Q', conditionalOn: 'p' }, session)

      await expect(assertNoConditionalCycle(mun.id, 'r', 'q')).resolves.toBeUndefined()
    })
  })

  describe('updateFormField', () => {
    it('lets the owning organizer update a field', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const field = await createFormField({ munId: mun.id, fieldKey: 'label_test', fieldType: 'SHORT_TEXT', label: 'Old' }, session)

      const updated = await updateFormField(field.id, { label: 'New' }, session)
      expect(updated.label).toBe('New')
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const field = await createFormField({ munId: mun.id, fieldKey: 'k', fieldType: 'SHORT_TEXT', label: 'K' }, sessionFor(owner))

      await expect(updateFormField(field.id, { label: 'Hacked' }, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })

    it('rejects switching to DROPDOWN without choices', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const field = await createFormField({ munId: mun.id, fieldKey: 'switchable', fieldType: 'SHORT_TEXT', label: 'S' }, session)

      await expect(updateFormField(field.id, { fieldType: 'DROPDOWN' }, session)).rejects.toThrow(/requires a non-empty choices array/)
    })

    it('rejects a rename that would create a fieldKey collision', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      await createFormField({ munId: mun.id, fieldKey: 'taken', fieldType: 'SHORT_TEXT', label: 'Taken' }, session)
      const field = await createFormField({ munId: mun.id, fieldKey: 'renameable', fieldType: 'SHORT_TEXT', label: 'R' }, session)

      await expect(updateFormField(field.id, { fieldKey: 'taken' }, session)).rejects.toThrow(/fieldKey.*unique/i)
    })
  })

  describe('deleteFormField', () => {
    it('lets the owning organizer delete a field with no dependents', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const field = await createFormField({ munId: mun.id, fieldKey: 'deletable', fieldType: 'SHORT_TEXT', label: 'D' }, session)

      await deleteFormField(field.id, session)

      const [row] = await db.select().from(munFormFields).where(eq(munFormFields.id, field.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects deleting a field that another field conditionalOn references, naming the dependent', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const parent = await createFormField(
        { munId: mun.id, fieldKey: 'parent_field', fieldType: 'DROPDOWN', label: 'Parent', choices: ['Yes', 'No'] },
        session,
      )
      await createFormField(
        { munId: mun.id, fieldKey: 'child_field', fieldType: 'SHORT_TEXT', label: 'Child', conditionalOn: 'parent_field' },
        session,
      )

      await expect(deleteFormField(parent.id, session)).rejects.toThrow(/child_field/)
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const field = await createFormField({ munId: mun.id, fieldKey: 'k2', fieldType: 'SHORT_TEXT', label: 'K2' }, sessionFor(owner))

      await expect(deleteFormField(field.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })
  })

  describe('reorderFormFields', () => {
    it('updates displayOrder for fields belonging to the mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const first = await createFormField({ munId: mun.id, fieldKey: 'first', fieldType: 'SHORT_TEXT', label: 'First', displayOrder: 0 }, session)
      const second = await createFormField({ munId: mun.id, fieldKey: 'second', fieldType: 'SHORT_TEXT', label: 'Second', displayOrder: 1 }, session)

      const reordered = await reorderFormFields(
        { munId: mun.id, order: [{ id: first.id, displayOrder: 1 }, { id: second.id, displayOrder: 0 }] },
        session,
      )

      expect(reordered[0].id).toBe(second.id)
      expect(reordered[1].id).toBe(first.id)
    })

    it('rejects an id belonging to a different mun (IDOR)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const fieldOfB = await createFormField({ munId: munB.id, fieldKey: 'of_b', fieldType: 'SHORT_TEXT', label: 'Of B' }, session)

      await expect(
        reorderFormFields({ munId: munA.id, order: [{ id: fieldOfB.id, displayOrder: 0 }] }, session),
      ).rejects.toThrow(/does not belong/)
    })
  })

  describe('listFormFields', () => {
    it('lists fields scoped to the given mun only, ordered by displayOrder', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createFormField({ munId: munA.id, fieldKey: 'a2', fieldType: 'SHORT_TEXT', label: 'A2', displayOrder: 1 }, session)
      await createFormField({ munId: munA.id, fieldKey: 'a1', fieldType: 'SHORT_TEXT', label: 'A1', displayOrder: 0 }, session)
      await createFormField({ munId: munB.id, fieldKey: 'b1', fieldType: 'SHORT_TEXT', label: 'B1' }, session)

      const listA = await listFormFields(munA.id)
      const custom = listA.filter((f) => !DEFAULT_KEYS.has(f.fieldKey))
      expect(custom.map((f) => f.fieldKey)).toEqual(['a1', 'a2'])
      expect(listA.map((f) => f.fieldKey)).not.toContain('b1')
      // displayOrder: a1 (0), a2 (1), then the defaults (10+).
      expect(listA.map((f) => f.fieldKey)).toEqual(['a1', 'a2', ...DEFAULT_REGISTRATION_FIELDS.map((f) => f.fieldKey)])
    })

    it('never writes: missing default fields are returned as synthetic read-only fields', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)

      const fields = await listFormFields(mun.id)

      expect(await storedRowCount(mun.id)).toBe(0)
      expect(fields.map((f) => f.fieldKey)).toEqual(DEFAULT_REGISTRATION_FIELDS.map((f) => f.fieldKey))
      expect(fields.every((f) => f.id === `default:${f.fieldKey}` && f.munId === mun.id)).toBe(true)
    })

    it('prefers a stored default field over its synthetic stand-in', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await listFormFieldsForOrganizer(mun.id, sessionFor(organizer))
      const [stored] = await db
        .update(munFormFields)
        .set({ label: 'Class / year' })
        .where(and(eq(munFormFields.munId, mun.id), eq(munFormFields.fieldKey, 'grade_class')))
        .returning()

      const fields = await listFormFields(mun.id)

      expect(fields).toHaveLength(DEFAULT_REGISTRATION_FIELDS.length)
      expect(fields.find((f) => f.fieldKey === 'grade_class')).toMatchObject({ id: stored.id, label: 'Class / year' })
      expect(fields.some((f) => f.id.startsWith('default:'))).toBe(false)
    })
  })

  describe('listFormFieldsForOrganizer', () => {
    it('materializes the default fields once for the owner and returns real rows', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const first = await listFormFieldsForOrganizer(mun.id, session)
      const second = await listFormFieldsForOrganizer(mun.id, session)

      expect(await storedRowCount(mun.id)).toBe(DEFAULT_REGISTRATION_FIELDS.length)
      expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id))
      expect(first.some((f) => f.id.startsWith('default:'))).toBe(false)
    })

    it('lets an admin through', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)

      const fields = await listFormFieldsForOrganizer(mun.id, sessionFor(admin))
      expect(fields).toHaveLength(DEFAULT_REGISTRATION_FIELDS.length)
    })

    it('rejects anyone else without writing', async () => {
      const organizer = await makeUser('ORGANIZER')
      const other = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)

      await expect(listFormFieldsForOrganizer(mun.id, sessionFor(other))).rejects.toThrow('Forbidden')
      await expect(listFormFieldsForOrganizer(mun.id, null)).rejects.toThrow('Forbidden')
      expect(await storedRowCount(mun.id)).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Task 12 — structural re-verification exception (design doc Section 6).
  // detectHighImpactChange cannot see a field deletion or an
  // optional-to-required flip (REGISTRATION_FORM's HIGH_IMPACT_FIELDS list
  // is deliberately empty), so registration-form.ts calls
  // forceReverification directly for those two operations when the mun is
  // already past VERIFIED.
  // -----------------------------------------------------------------------
  describe('structural re-verification exception', () => {
    async function moduleState(munId: string) {
      const [row] = await db
        .select()
        .from(munModuleVerifications)
        .where(and(eq(munModuleVerifications.munId, munId), eq(munModuleVerifications.moduleName, 'REGISTRATION_FORM')))
      return row
    }

    it('forces re-verification when deleting a field on a post-VERIFIED mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const field = await createFormField({ munId: mun.id, fieldKey: 'to_delete', fieldType: 'SHORT_TEXT', label: 'D' }, session)

      // Move the mun to VERIFIED and mark the module VERIFIED after field
      // creation, so onModuleDataChanged's own create-time pass doesn't
      // interfere with the assertion below.
      await db.update(muns).set({ status: 'VERIFIED' }).where(eq(muns.id, mun.id))
      await db
        .update(munModuleVerifications)
        .set({ state: 'VERIFIED' })
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'REGISTRATION_FORM')))

      await deleteFormField(field.id, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('VERIFICATION')

      const row = await moduleState(mun.id)
      expect(row?.state).toBe('PENDING_REVIEW')
    })

    it('forces re-verification when flipping a field from optional to required on a post-VERIFIED mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const field = await createFormField(
        { munId: mun.id, fieldKey: 'opt_to_req', fieldType: 'SHORT_TEXT', label: 'O', required: false },
        session,
      )

      await db.update(muns).set({ status: 'VERIFIED' }).where(eq(muns.id, mun.id))
      await db
        .update(munModuleVerifications)
        .set({ state: 'VERIFIED' })
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'REGISTRATION_FORM')))

      await updateFormField(field.id, { required: true }, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('VERIFICATION')

      const row = await moduleState(mun.id)
      expect(row?.state).toBe('PENDING_REVIEW')
    })

    it('does NOT force re-verification for a field delete on a pre-VERIFIED (ONBOARDING) mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'ONBOARDING' })
      const session = sessionFor(organizer)
      const field = await createFormField({ munId: mun.id, fieldKey: 'onboarding_delete', fieldType: 'SHORT_TEXT', label: 'D' }, session)

      await deleteFormField(field.id, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      // onModuleDataChanged may still materialize ACTION_REQUIRED/READY_FOR_SUBMISSION
      // during onboarding, but it must never reach VERIFICATION from here.
      expect(updatedMun.status).not.toBe('VERIFICATION')
    })

    it('does NOT force re-verification for an optional-to-required flip on a pre-VERIFIED (ONBOARDING) mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'ONBOARDING' })
      const session = sessionFor(organizer)
      const field = await createFormField(
        { munId: mun.id, fieldKey: 'onboarding_flip', fieldType: 'SHORT_TEXT', label: 'O', required: false },
        session,
      )

      await updateFormField(field.id, { required: true }, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).not.toBe('VERIFICATION')
    })

    it('does NOT force re-verification for a required-to-optional flip (only optional->required matters) even post-VERIFIED', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const field = await createFormField(
        { munId: mun.id, fieldKey: 'req_to_opt', fieldType: 'SHORT_TEXT', label: 'R', required: true },
        session,
      )

      await db.update(muns).set({ status: 'VERIFIED' }).where(eq(muns.id, mun.id))
      await db
        .update(munModuleVerifications)
        .set({ state: 'VERIFIED' })
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'REGISTRATION_FORM')))

      await updateFormField(field.id, { required: false }, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('VERIFIED')

      const row = await moduleState(mun.id)
      expect(row?.state).toBe('VERIFIED')
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
