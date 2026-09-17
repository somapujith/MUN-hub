/**
 * Database helpers that create and reset the E2E fixture MUNs. Used by
 * prepare-db.ts on every run, and by specs that need a fixture reset right
 * before they use it (so a rerun with E2E_SKIP_DB_PREPARE still starts clean).
 *
 * Local database only: every entry point asserts it.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { hashPassword } from '../../lib/auth/password'
import { seedFullGoLiveModules } from '../../lib/db/seed-go-live-modules'
import * as schema from '../../lib/db/schema'
import { DATABASE_URL, assertLocalDatabase } from '../env'
import { ACCOUNTS, DEMO_PASSWORD } from './accounts'
import { FIXTURE_MUNS } from './fixture-muns'

const DAY = 24 * 60 * 60 * 1000

function connect() {
  assertLocalDatabase(DATABASE_URL)
  const client = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  return { client, db: drizzle(client, { schema }) }
}

export type FixtureDb = ReturnType<typeof connect>['db']
export type Tx = Parameters<Parameters<FixtureDb['transaction']>[0]>[0]
export type ReadyMunDef = (typeof FIXTURE_MUNS)['review' | 'suspend' | 'confirm' | 'adminConsole']

/** Runs the callback with a short-lived connection to the local test database. */
export async function withFixtureDb<T>(fn: (db: FixtureDb) => Promise<T>): Promise<T> {
  const { client, db } = connect()
  try {
    return await fn(db)
  } finally {
    await client.end()
  }
}

/**
 * Deletes and recreates one of the ready-to-submit fixture MUNs (every go-live
 * module filled in, status ONBOARDING). Returns its new id.
 */
export async function recreateReadyMun(def: ReadyMunDef): Promise<string> {
  return withFixtureDb(async (db) => {
    const ownerId = await organizerId(db)
    await db.transaction((tx) => recreateReadyToSubmitMun(tx, ownerId, def))
    const [mun] = await db.select({ id: schema.muns.id }).from(schema.muns).where(eq(schema.muns.slug, def.slug))
    return mun.id
  })
}

export async function organizerId(db: FixtureDb): Promise<string> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, FIXTURE_MUNS.ownerEmail))
  if (!row) throw new Error(`prepare-db: seeded organizer ${FIXTURE_MUNS.ownerEmail} not found — did the seed run?`)
  return row.id
}

export async function upsertMun(
  tx: Tx,
  ownerId: string,
  def: { slug: string; name: string },
  status: (typeof schema.muns.$inferInsert)['status'],
): Promise<string> {
  const now = Date.now()
  const values = {
    organizerId: ownerId,
    name: def.name,
    slug: def.slug,
    edition: '2026',
    theme: 'End-to-end testing in a fractured world',
    description: `${def.name} is a fixture conference used by the automated end-to-end test suite.`,
    startDate: new Date(now + 90 * DAY),
    endDate: new Date(now + 92 * DAY),
    venue: 'E2E Convention Centre',
    city: 'Hyderabad',
    country: 'India',
    registrationOpensAt: new Date(now - 30 * DAY),
    registrationDeadline: new Date(now + 60 * DAY),
    status,
    publishedAt: status === 'ONBOARDING' ? null : new Date(now - 30 * DAY),
    updatedAt: new Date(),
  }
  const [row] = await tx
    .insert(schema.muns)
    .values(values)
    .onConflictDoUpdate({ target: schema.muns.slug, set: values })
    .returning({ id: schema.muns.id })
  return row.id
}

export async function ensureCommittee(
  tx: Tx,
  munId: string,
  def: { name: string; capacity: number; portfolioSeats?: number; portfolios: readonly string[] },
): Promise<void> {
  const availability = def.portfolioSeats ?? 1
  let [committee] = await tx
    .select()
    .from(schema.committees)
    .where(and(eq(schema.committees.munId, munId), eq(schema.committees.name, def.name)))
  if (committee) {
    await tx
      .update(schema.committees)
      .set({ capacity: def.capacity, portfoliosEnabled: true })
      .where(eq(schema.committees.id, committee.id))
  } else {
    ;[committee] = await tx
      .insert(schema.committees)
      .values({
        munId,
        name: def.name,
        agenda: `${def.name} agenda for automated testing.`,
        capacity: def.capacity,
        portfoliosEnabled: true,
      })
      .returning()
  }

  await tx
    .update(schema.portfolios)
    .set({ availability })
    .where(eq(schema.portfolios.committeeId, committee.id))
  const existing = await tx
    .select({ name: schema.portfolios.name })
    .from(schema.portfolios)
    .where(eq(schema.portfolios.committeeId, committee.id))
  const have = new Set(existing.map((p) => p.name))
  const missing = def.portfolios.filter((name) => !have.has(name))
  if (missing.length) {
    await tx
      .insert(schema.portfolios)
      .values(missing.map((name) => ({ committeeId: committee.id, name, type: 'country', availability })))
  }
}

export async function ensureProduct(
  tx: Tx,
  munId: string,
  def: { name: string; price: number; capacity: number; status: string; displayOrder: number },
): Promise<void> {
  const values = {
    munId,
    name: def.name,
    price: def.price,
    capacity: def.capacity,
    status: def.status,
    displayOrder: def.displayOrder,
    registrationType: 'DELEGATE',
    currency: 'INR',
    deadline: null,
    allowsIndividual: true,
  }
  const [existing] = await tx
    .select({ id: schema.registrationProducts.id })
    .from(schema.registrationProducts)
    .where(and(eq(schema.registrationProducts.munId, munId), eq(schema.registrationProducts.name, def.name)))
  if (existing) {
    await tx.update(schema.registrationProducts).set(values).where(eq(schema.registrationProducts.id, existing.id))
  } else {
    await tx.insert(schema.registrationProducts).values(values)
  }
}

/**
 * Removes a fixture MUN completely so it can be recreated from scratch. Most
 * child tables cascade; these don't.
 */
export async function deleteMunBySlug(tx: Tx, slug: string): Promise<void> {
  const [mun] = await tx.select({ id: schema.muns.id }).from(schema.muns).where(eq(schema.muns.slug, slug))
  if (!mun) return
  await wipeRegistrations(tx, mun.id)
  await tx.delete(schema.certificates).where(eq(schema.certificates.munId, mun.id))
  await tx.delete(schema.achievements).where(eq(schema.achievements.munId, mun.id))
  await tx.delete(schema.organizerApplications).where(eq(schema.organizerApplications.munId, mun.id))
  await tx.update(schema.supportTickets).set({ relatedMunId: null }).where(eq(schema.supportTickets.relatedMunId, mun.id))
  await tx.update(schema.organizerProfiles).set({ firstMunId: null }).where(eq(schema.organizerProfiles.firstMunId, mun.id))
  await tx.delete(schema.muns).where(eq(schema.muns.id, mun.id))
}

/**
 * Deletes and recreates an ONBOARDING MUN with every go-live module filled in
 * (the demo seed's full data plus the checks that seed doesn't cover), ready to
 * pass automated validation and go through Gate 2.
 */
export async function recreateReadyToSubmitMun(
  tx: Tx,
  ownerId: string,
  def: ReadyMunDef,
): Promise<void> {
  await deleteMunBySlug(tx, def.slug)
  const munId = await upsertMun(tx, ownerId, def, 'ONBOARDING')
  for (const c of def.committees) await ensureCommittee(tx, munId, c)
  for (const p of def.products) await ensureProduct(tx, munId, p)
  const committees = await tx.select().from(schema.committees).where(eq(schema.committees.munId, munId))
  await seedFullGoLiveModules({
    db: tx as unknown as Parameters<typeof seedFullGoLiveModules>[0]['db'],
    tables: schema,
    munId,
    munName: def.name,
    organizerId: ownerId,
    committees,
  })
  await tx
    .update(schema.muns)
    .set({
      addressLine1: '1 Review Street, Banjara Hills',
      addressState: 'Telangana',
      postalCode: '500034',
      accommodationProvided: 'NOT_PROVIDED',
    })
    .where(eq(schema.muns.id, munId))
}

/** A payout account MUNHub has already verified — opening registration for paid passes needs one. */
export async function ensureVerifiedPaymentAccount(tx: Tx, munId: string): Promise<void> {
  const values = {
    munId,
    legalName: 'E2E Lifecycle Society',
    orgType: 'SOCIETY',
    addressLine1: '1 Test Street',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    panLast4: '234F',
    panCiphertext: 'e2e-not-real-ciphertext',
    authorizedRepName: 'E2E Owner',
    authorizedRepEmail: FIXTURE_MUNS.ownerEmail,
    accountHolderName: 'E2E Lifecycle Society',
    bankName: 'E2E Test Bank',
    accountNumberLast4: '6789',
    accountNumberCiphertext: 'e2e-not-real-ciphertext',
    ifsc: 'E2EB0000001',
    accountType: 'CURRENT',
    gateway: 'RAZORPAY',
    verificationState: 'VERIFIED' as const,
    verifiedAt: new Date(),
    updatedAt: new Date(),
  }
  await tx
    .insert(schema.munPaymentSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.munPaymentSettings.munId, set: values })
}

/** Deletes every registration on a MUN, and everything that references those registrations. */
export async function wipeRegistrations(tx: Tx, munId: string): Promise<number> {
  const regs = await tx
    .select({ id: schema.registrations.id })
    .from(schema.registrations)
    .where(eq(schema.registrations.munId, munId))
  const ids = regs.map((r) => r.id)
  if (!ids.length) return 0
  await tx.delete(schema.payments).where(inArray(schema.payments.registrationId, ids))
  await tx.delete(schema.certificates).where(inArray(schema.certificates.registrationId, ids))
  await tx.delete(schema.achievements).where(inArray(schema.achievements.registrationId, ids))
  await tx
    .update(schema.supportTickets)
    .set({ relatedRegistrationId: null })
    .where(inArray(schema.supportTickets.relatedRegistrationId, ids))
  await tx.delete(schema.registrations).where(inArray(schema.registrations.id, ids))
  return ids.length
}

/**
 * The per-role setup signs in as the seeded accounts with the demo password.
 * Other test suites share this local database and have been seen changing
 * those passwords, and the seed only fills in a missing hash, so put them back.
 */
export async function resetSeededLogins(db: FixtureDb): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  await db
    .update(schema.users)
    .set({ passwordHash, suspended: false })
    .where(inArray(schema.users.email, Object.values(ACCOUNTS).map((account) => account.email)))
}
