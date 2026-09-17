import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { committees, muns, munModuleVerifications, portfolios, registrationProducts, users, verificationIssues } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import {
  createCommittee,
  createPortfolio,
  createPortfolios,
  createRegistrationProduct,
  deleteCommittee,
  deletePortfolio,
  deleteRegistrationProduct,
  listCommittees,
  listPortfolios,
  listRegistrationProducts,
  submitMunForVerification,
  updateCommittee,
  updateMunDetails,
  updatePortfolio,
  updateRegistrationProduct,
} from './mun-config'

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
      name: 'Config Mun',
      slug: `config-mun-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('mun-config actions', () => {
  describe('committees', () => {
    it('lets the owning organizer create, update, and delete a committee', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const committee = await createCommittee(
        { munId: mun.id, name: 'UNGA', agenda: 'Climate', capacity: 50 },
        session,
      )
      expect(committee.name).toBe('UNGA')
      expect(committee.munId).toBe(mun.id)

      const updated = await updateCommittee(committee.id, { name: 'UNGA Plenary', capacity: 60 }, session)
      expect(updated.name).toBe('UNGA Plenary')
      expect(updated.capacity).toBe(60)

      await deleteCommittee(committee.id, session)
      const [row] = await db.select().from(committees).where(eq(committees.id, committee.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects a non-owning organizer on create/update/delete', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const strangerSession = sessionFor(stranger)

      await expect(
        createCommittee({ munId: mun.id, name: 'UNSC', capacity: 15 }, strangerSession),
      ).rejects.toThrow('Forbidden')

      const [committee] = await db
        .insert(committees)
        .values({ munId: mun.id, name: 'UNSC', capacity: 15 })
        .returning()

      await expect(updateCommittee(committee.id, { name: 'Hacked' }, strangerSession)).rejects.toThrow(
        'Forbidden',
      )
      await expect(deleteCommittee(committee.id, strangerSession)).rejects.toThrow('Forbidden')
    })

    it('lets an admin act on any mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id)
      const adminSession = sessionFor(admin)

      const committee = await createCommittee(
        { munId: mun.id, name: 'ECOSOC', capacity: 40 },
        adminSession,
      )
      expect(committee.name).toBe('ECOSOC')

      const updated = await updateCommittee(committee.id, { capacity: 45 }, adminSession)
      expect(updated.capacity).toBe(45)

      await deleteCommittee(committee.id, adminSession)
      const [row] = await db.select().from(committees).where(eq(committees.id, committee.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('lists committees scoped to the given mun only', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createCommittee({ munId: munA.id, name: 'A1', capacity: 10 }, session)
      await createCommittee({ munId: munA.id, name: 'A2', capacity: 10 }, session)
      await createCommittee({ munId: munB.id, name: 'B1', capacity: 10 }, session)

      const listA = await listCommittees(munA.id)
      expect(listA).toHaveLength(2)
      expect(listA.every((c) => c.munId === munA.id)).toBe(true)

      const listB = await listCommittees(munB.id)
      expect(listB).toHaveLength(1)
    })
  })

  describe('portfolios', () => {
    it('lets the owning organizer create, update, and delete a portfolio', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const committee = await createCommittee({ munId: mun.id, name: 'UNGA', capacity: 50 }, session)

      const portfolio = await createPortfolio(
        { committeeId: committee.id, name: 'Germany', type: 'country' },
        session,
      )
      expect(portfolio.name).toBe('Germany')

      const updated = await updatePortfolio(portfolio.id, { name: 'France' }, session)
      expect(updated.name).toBe('France')

      await deletePortfolio(portfolio.id, session)
      const [row] = await db.select().from(portfolios).where(eq(portfolios.id, portfolio.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects a non-owning organizer via committee -> mun ownership walk', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const ownerSession = sessionFor(owner)
      const committee = await createCommittee({ munId: mun.id, name: 'UNSC', capacity: 15 }, ownerSession)

      await expect(
        createPortfolio({ committeeId: committee.id, name: 'Russia' }, sessionFor(stranger)),
      ).rejects.toThrow('Forbidden')
    })

    it('lists portfolios scoped to the given committee only', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const committeeA = await createCommittee({ munId: mun.id, name: 'A', capacity: 10 }, session)
      const committeeB = await createCommittee({ munId: mun.id, name: 'B', capacity: 10 }, session)

      await createPortfolio({ committeeId: committeeA.id, name: 'US' }, session)
      await createPortfolio({ committeeId: committeeA.id, name: 'UK' }, session)
      await createPortfolio({ committeeId: committeeB.id, name: 'China' }, session)

      const listA = await listPortfolios(committeeA.id)
      expect(listA).toHaveLength(2)
      const listB = await listPortfolios(committeeB.id)
      expect(listB).toHaveLength(1)
    })

    it('refuses a duplicate portfolio name in the same committee, ignoring case and spaces', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const committee = await createCommittee({ munId: mun.id, name: 'UNHRC', capacity: 30 }, session)
      const other = await createCommittee({ munId: mun.id, name: 'DISEC', capacity: 30 }, session)

      const india = await createPortfolio({ committeeId: committee.id, name: '  India ' }, session)
      expect(india.name).toBe('India')
      await expect(createPortfolio({ committeeId: committee.id, name: 'india' }, session)).rejects.toThrow(
        'A portfolio named "India" already exists in this committee',
      )
      // Another committee may reuse the name.
      await expect(createPortfolio({ committeeId: other.id, name: 'India' }, session)).resolves.toBeDefined()

      const japan = await createPortfolio({ committeeId: committee.id, name: 'Japan' }, session)
      await expect(updatePortfolio(japan.id, { name: 'INDIA' }, session)).rejects.toThrow(/already exists/)
      // Renaming to its own name (a no-op save) is fine.
      await expect(updatePortfolio(japan.id, { name: 'Japan', availability: 2 }, session)).resolves.toMatchObject({
        availability: 2,
      })
    })

    it('adds many portfolios at once, all or nothing', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const committee = await createCommittee({ munId: mun.id, name: 'UNSC', capacity: 15 }, session)
      await createPortfolio({ committeeId: committee.id, name: 'France' }, session)

      const created = await createPortfolios(
        committee.id,
        [
          { name: 'United States', type: 'country' },
          { name: 'China', type: 'country' },
        ],
        session,
      )
      expect(created.map((p) => p.name)).toEqual(['United States', 'China'])

      await expect(
        createPortfolios(committee.id, [{ name: 'Brazil' }, { name: 'brazil' }], session),
      ).rejects.toThrow('A portfolio named "brazil" already exists in this committee')
      await expect(createPortfolios(committee.id, [{ name: 'Kenya' }, { name: 'FRANCE' }], session)).rejects.toThrow(
        'A portfolio named "France" already exists in this committee',
      )
      expect(await listPortfolios(committee.id)).toHaveLength(3)

      const stranger = await makeUser('ORGANIZER')
      await expect(createPortfolios(committee.id, [{ name: 'Chile' }], sessionFor(stranger))).rejects.toThrow('Forbidden')
    })
  })

  describe('registration products', () => {
    it('lets the owning organizer create and update a product', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const product = await createRegistrationProduct(
        { munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 },
        session,
      )
      expect(product.price).toBe(2000)
      expect(product.status).toBe('active')

      const updated = await updateRegistrationProduct(product.id, { price: 2500 }, session)
      expect(updated.price).toBe(2500)
    })

    it('clears deadline to null without a cast workaround', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const product = await createRegistrationProduct(
        { munId: mun.id, name: 'Delegate', price: 2000, capacity: 100, deadline: new Date('2027-01-01') },
        session,
      )
      expect(product.deadline).not.toBeNull()

      const cleared = await updateRegistrationProduct(product.id, { deadline: null }, session)
      expect(cleared.deadline).toBeNull()
    })

    it('listRegistrationProducts returns only the given mun\'s products, no auth required', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await createRegistrationProduct({ munId: munA.id, name: 'Delegate A', price: 1000, capacity: 50 }, session)
      await createRegistrationProduct({ munId: munB.id, name: 'Delegate B', price: 2000, capacity: 50 }, session)

      const listA = await listRegistrationProducts(munA.id)
      expect(listA.length).toBe(1)
      expect(listA[0].name).toBe('Delegate A')
    })

    it('listRegistrationProducts excludes soft-deleted products by default, includes them with includeInactive', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const active = await createRegistrationProduct({ munId: mun.id, name: 'Active Product', price: 1000, capacity: 50 }, session)
      const archived = await createRegistrationProduct({ munId: mun.id, name: 'Archived Product', price: 1000, capacity: 50 }, session)
      await deleteRegistrationProduct(archived.id, session)

      const activeOnly = await listRegistrationProducts(mun.id)
      expect(activeOnly.map((p) => p.id)).toEqual([active.id])

      const all = await listRegistrationProducts(mun.id, { includeInactive: true })
      expect(all.length).toBe(2)
    })

    it('soft-deletes: row still exists with status inactive, excluded from default reads', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const product = await createRegistrationProduct(
        { munId: mun.id, name: 'Press', price: 1000, capacity: 20 },
        session,
      )

      await deleteRegistrationProduct(product.id, session)

      const [row] = await db
        .select()
        .from(registrationProducts)
        .where(eq(registrationProducts.id, product.id))
        .limit(1)
      expect(row).toBeDefined()
      expect(row.status).toBe('inactive')

      const [activeRow] = await db
        .select()
        .from(registrationProducts)
        .where(and(eq(registrationProducts.id, product.id), eq(registrationProducts.status, 'active')))
        .limit(1)
      expect(activeRow).toBeUndefined()
    })

    it('rejects a non-owning organizer', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        createRegistrationProduct(
          { munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 },
          sessionFor(stranger),
        ),
      ).rejects.toThrow('Forbidden')
    })

    describe('createRegistrationProduct — new field passthrough', () => {
      it('persists description, allowsIndividual, allowsDelegation, displayOrder, eligibility', async () => {
        const organizer = await makeUser('ORGANIZER')
        const mun = await makeMun(organizer.id)

        const product = await createRegistrationProduct(
          {
            munId: mun.id,
            name: 'Reporter Pass',
            price: 1000,
            capacity: 20,
            description: 'For press and media delegates.',
            allowsIndividual: true,
            allowsDelegation: false,
            displayOrder: 2,
            eligibility: { minAge: 16 },
          },
          { userId: organizer.id, role: 'ORGANIZER' },
        )

        expect(product.description).toBe('For press and media delegates.')
        expect(product.allowsDelegation).toBe(false)
        expect(product.displayOrder).toBe(2)
        expect(product.eligibility).toEqual({ minAge: 16 })
      })
    })
  })

  describe('updateMunDetails', () => {
    it('lets the owning organizer update editable mun fields', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const updated = await updateMunDetails(
        mun.id,
        { name: 'Renamed MUN', city: 'Delhi', country: 'India', theme: 'New Theme' },
        session,
      )
      expect(updated.name).toBe('Renamed MUN')
      expect(updated.city).toBe('Delhi')
      expect(updated.theme).toBe('New Theme')
    })

    it('clears a nullable field (venue) to null without a cast workaround', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { venue: 'Main Hall' })
      const session = sessionFor(organizer)

      const cleared = await updateMunDetails(mun.id, { venue: null }, session)
      expect(cleared.venue).toBeNull()
    })

    it('saves the address and registration window, which completes the Dates & Venue module', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'ONBOARDING' })
      const session = sessionFor(organizer)

      const updated = await updateMunDetails(
        mun.id,
        {
          startDate: new Date('2027-03-10'),
          endDate: new Date('2027-03-12'),
          venue: 'Convention Centre',
          addressLine1: '12 Lake Road',
          addressState: 'Telangana',
          postalCode: '500001',
          city: 'Hyderabad',
          country: 'India',
          mapUrl: 'https://maps.example/venue',
          registrationOpensAt: new Date('2027-01-01'),
          registrationDeadline: new Date('2027-03-01'),
        },
        session,
      )
      expect(updated).toMatchObject({ addressLine1: '12 Lake Road', addressState: 'Telangana', postalCode: '500001' })
      expect(updated.registrationOpensAt?.toISOString().slice(0, 10)).toBe('2027-01-01')
      expect(updated.registrationDeadline?.toISOString().slice(0, 10)).toBe('2027-03-01')

      const [datesVenue] = await db
        .select()
        .from(munModuleVerifications)
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'DATES_VENUE')))
      expect(datesVenue.completionStatus).toBe('COMPLETE')
    })

    it('refuses a registration window that would close registration by accident', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'ONBOARDING' })
      const session = sessionFor(organizer)

      await expect(
        updateMunDetails(
          mun.id,
          { registrationOpensAt: new Date('2027-03-01'), registrationDeadline: new Date('2027-01-01') },
          session,
        ),
      ).rejects.toThrow('Registration deadline must be after registration opens')

      await updateMunDetails(
        mun.id,
        { startDate: new Date('2027-03-10'), registrationOpensAt: new Date('2027-01-01'), registrationDeadline: new Date('2027-03-01') },
        session,
      )
      // Moving only the start date before the saved deadline is checked against the saved deadline.
      await expect(updateMunDetails(mun.id, { startDate: new Date('2027-02-15') }, session)).rejects.toThrow(
        'Registration deadline must be before the conference starts',
      )
      // Clearing the deadline is allowed.
      const cleared = await updateMunDetails(mun.id, { registrationDeadline: null }, session)
      expect(cleared.registrationDeadline).toBeNull()
    })

    it('rejects a non-owning organizer', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        updateMunDetails(mun.id, { name: 'Hacked' }, sessionFor(stranger)),
      ).rejects.toThrow('Forbidden')
    })

    it('lets an admin update any mun', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('SUPER_ADMIN')
      const mun = await makeMun(organizer.id)

      const updated = await updateMunDetails(mun.id, { name: 'Admin Edited' }, sessionFor(admin))
      expect(updated.name).toBe('Admin Edited')
    })
  })

  describe('submitMunForVerification', () => {
    it('transitions a CONTENT_SUBMITTED mun to VERIFICATION for its owning organizer', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'CONTENT_SUBMITTED' })

      const result = await submitMunForVerification(mun.id, sessionFor(organizer))
      expect(result.status).toBe('VERIFICATION')
    })

    it('rejects a non-owning organizer', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id, { status: 'CONTENT_SUBMITTED' })

      await expect(submitMunForVerification(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })

    it('rejects an invalid transition (mun not in CONTENT_SUBMITTED)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'DRAFT' })

      await expect(submitMunForVerification(mun.id, sessionFor(organizer))).rejects.toThrow(
        'Invalid transition',
      )
    })
  })

  describe('re-verification triggers', () => {
    it('updateRegistrationProduct triggers re-verification when mun is VERIFIED and price changes', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'VERIFIED' })
      const session = sessionFor(organizer)

      const product = await createRegistrationProduct({ munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 }, session)
      await db.insert(munModuleVerifications).values({ munId: mun.id, moduleName: 'registration_products', state: 'VERIFIED' })

      await updateRegistrationProduct(product.id, { price: 3000 }, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('VERIFICATION')
    })

    // The public page shows the street address and links out to mapUrl, so
    // changing either on a live MUN must go back through review — the same
    // rule venue/city already had.
    it.each([
      ['addressLine1', { addressLine1: '9 Other Street' }],
      ['addressState', { addressState: 'Karnataka' }],
      ['postalCode', { postalCode: '560001' }],
      ['mapUrl', { mapUrl: 'https://attacker.example/venue' }],
    ])('updateMunDetails triggers re-verification when a PUBLISHED mun changes %s', async (_field, patch) => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, {
        status: 'PUBLISHED',
        addressLine1: '12 Lake Road',
        addressState: 'Telangana',
        postalCode: '500001',
        mapUrl: 'https://maps.example/venue',
      })
      const session = sessionFor(organizer)

      await updateMunDetails(mun.id, patch, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('VERIFICATION')
      const [datesVenue] = await db
        .select()
        .from(munModuleVerifications)
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'DATES_VENUE')))
      expect(datesVenue.state).toBe('PENDING_REVIEW')
    })

    it('updateMunDetails triggers re-verification when a VERIFIED mun clears its street address', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'VERIFIED', addressLine1: '12 Lake Road' })
      const session = sessionFor(organizer)

      await updateMunDetails(mun.id, { addressLine1: null }, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('VERIFICATION')
    })

    it('updateRegistrationProduct does NOT trigger re-verification when mun is still DRAFT', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const product = await createRegistrationProduct({ munId: mun.id, name: 'Delegate', price: 2000, capacity: 100 }, session)
      await updateRegistrationProduct(product.id, { price: 3000 }, session)

      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('DRAFT')
    })
  })

  describe('progress engine wiring (Task 8 integration proof, updated for Task 9 real validators)', () => {
    it('a committee edit moves the COMMITTEES module row — proves onModuleDataChanged is actually wired, not just unit-tested in isolation', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id, { status: 'ONBOARDING' })
      const session = sessionFor(organizer)

      // Task 9 note: COMMITTEES' real validator (lib/lifecycle/validators/
      // committees.ts) requires a non-empty agenda, not just a capacity —
      // this create call now supplies one so the module genuinely reaches
      // COMPLETE, which is what this test needs to prove wiring (not the
      // validator's own correctness — that's validators/committees.test.ts's
      // job).
      const committee = await createCommittee(
        { munId: mun.id, name: 'UNGA', agenda: 'General debate', capacity: 50 },
        session,
      )

      const [committeeModuleRow] = await db
        .select()
        .from(munModuleVerifications)
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
      expect(committeeModuleRow).toBeDefined()
      expect(committeeModuleRow.lastComputedAt).not.toBeNull()
      expect(committeeModuleRow.completionStatus).toBe('COMPLETE')

      // Mun-level materialization ran too, but with Task 9's real validators
      // the OTHER 14 modules are still empty on this bare test mun — so the
      // mun correctly stays ACTION_REQUIRED (required work remains), not
      // READY_FOR_SUBMISSION. What this test proves is narrower and still
      // correct: `onModuleDataChanged` genuinely ran end to end from the
      // `createCommittee` action (lastComputedAt is set, completionStatus
      // reflects the real validator), not that the mun cleared every module.
      const [updatedMun] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(updatedMun.status).toBe('ACTION_REQUIRED')

      // Now edit the same committee via the UPDATE path (not just create)
      // while a BLOCKER issue is outstanding, and confirm the engine
      // re-runs: the COMMITTEES row is recomputed (still COMPLETE — the
      // validator only looks at committee data, not verificationIssues),
      // and the mun-level status stays ACTION_REQUIRED for the same reason
      // as above, now doubly so (a real BLOCKER issue on top of incomplete
      // modules).
      await db.insert(verificationIssues).values({
        munId: mun.id,
        moduleName: 'COMMITTEES',
        severity: 'BLOCKER',
        reason: 'Regression-test blocker',
        raisedBy: organizer.id,
      })
      await updateCommittee(committee.id, { capacity: 60 }, session)

      const [committeeModuleRowAfterUpdate] = await db
        .select()
        .from(munModuleVerifications)
        .where(and(eq(munModuleVerifications.munId, mun.id), eq(munModuleVerifications.moduleName, 'COMMITTEES')))
      expect(committeeModuleRowAfterUpdate.completionStatus).toBe('COMPLETE')

      const [munAfterUpdate] = await db.select().from(muns).where(eq(muns.id, mun.id))
      expect(munAfterUpdate.status).toBe('ACTION_REQUIRED')
    })
  })

  describe('createRegistrationProduct — Slice 1 fields', () => {
    it('defaults allowsIndividual to true and allowsDelegation to false', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)

      const product = await createRegistrationProduct(
        { munId: mun.id, name: 'Delegate', price: 1500, capacity: 100 },
        sessionFor(organizer),
      )

      expect(product.allowsIndividual).toBe(true)
      expect(product.allowsDelegation).toBe(false)
      expect(product.displayOrder).toBe(0)
      expect(product.description).toBeNull()
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
