/**
 * Puts the local database into the exact baseline the E2E suite assumes.
 * Runs on every suite start, after migrate + seed (see playwright.config.ts).
 *
 * Why this exists, rather than reusing seeded demo MUNs:
 * - No seeded MUN is actually open for registration (Oxford MUN 2027's
 *   registration window opens in 2027), so the registration funnel can't be
 *   exercised against seed data at all.
 * - The seed never resets a MUN's status on re-run, so a test that pushed a
 *   demo MUN into re-verification would leave every later run broken.
 * - Organizer specs edit MUN content. Editing high-impact fields on a
 *   published MUN sends it back to VERIFICATION, which would silently close
 *   registration for the student specs running in the same suite.
 *
 * So the suite owns three dedicated fixture MUNs, all belonging to the
 * seeded organizer, and resets them to a known state on every run:
 * - OPEN    — REGISTRATION_OPEN, window open; registrations wiped each run.
 * - SANDBOX — ONBOARDING; the only MUN organizer specs are allowed to edit.
 * - CLOSED  — PUBLISHED but not open, with an active pass; used to prove the
 *             API refuses registrations the UI would never offer.
 *
 * Refuses to touch anything but a local database.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../lib/db/schema'
import { DATABASE_URL, assertLocalDatabase } from './env'
import { FIXTURE_MUNS } from './fixtures/fixture-muns'

assertLocalDatabase(DATABASE_URL)

const DAY = 24 * 60 * 60 * 1000
const client = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
const db = drizzle(client, { schema })
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function organizerId(): Promise<string> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, FIXTURE_MUNS.ownerEmail))
  if (!row) throw new Error(`prepare-db: seeded organizer ${FIXTURE_MUNS.ownerEmail} not found — did the seed run?`)
  return row.id
}

async function upsertMun(
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

async function ensureCommittee(
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

async function ensureProduct(
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

/** Deletes every registration on a MUN, and everything that references those registrations. */
async function wipeRegistrations(tx: Tx, munId: string): Promise<number> {
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

async function main(): Promise<void> {
  const ownerId = await organizerId()
  // The fixture owner predates the organizer onboarding wizard; mark it done.
  await db
    .insert(schema.organizerProfiles)
    .values({
      userId: ownerId,
      firstName: 'E2E',
      lastName: 'Owner',
      contactPhone: '9876543210',
      upiId: 'e2e-owner@ybl',
      upiPhone: '9876543210',
      agreementVersion: 'e2e',
      completedAt: new Date(),
    })
    .onConflictDoNothing()

  await db.transaction(async (tx) => {
    const openId = await upsertMun(tx, ownerId, FIXTURE_MUNS.open, 'REGISTRATION_OPEN')
    for (const c of FIXTURE_MUNS.open.committees) await ensureCommittee(tx, openId, c)
    for (const p of FIXTURE_MUNS.open.products) await ensureProduct(tx, openId, p)
    const wiped = await wipeRegistrations(tx, openId)

    const sandboxId = await upsertMun(tx, ownerId, FIXTURE_MUNS.sandbox, 'ONBOARDING')
    for (const c of FIXTURE_MUNS.sandbox.committees) await ensureCommittee(tx, sandboxId, c)

    const closedId = await upsertMun(tx, ownerId, FIXTURE_MUNS.closed, 'PUBLISHED')
    for (const p of FIXTURE_MUNS.closed.products) await ensureProduct(tx, closedId, p)
    await wipeRegistrations(tx, closedId)

    console.log(
      `[e2e] fixtures ready: ${FIXTURE_MUNS.open.slug} (open, ${wiped} old registrations wiped), ` +
        `${FIXTURE_MUNS.sandbox.slug} (onboarding), ${FIXTURE_MUNS.closed.slug} (published, not open)`,
    )
  })
}

main()
  .catch((error) => {
    console.error('[e2e] prepare-db failed:', error)
    process.exitCode = 1
  })
  .finally(() => client.end())
