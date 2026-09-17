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
 * So the suite owns dedicated fixture MUNs, all belonging to the seeded
 * organizer, and resets them to a known state on every run:
 * - OPEN      — REGISTRATION_OPEN, window open; registrations wiped each run.
 * - SANDBOX   — ONBOARDING; the only MUN organizer specs are allowed to edit.
 * - CLOSED    — PUBLISHED but not open, with an active pass; used to prove the
 *               API refuses registrations the UI would never offer.
 * - LIFECYCLE — PUBLISHED with a verified payment account; the lifecycle spec
 *               opens, closes and cancels it.
 * - REVIEW    — ONBOARDING with every go-live module filled in; deleted and
 *               recreated each run for the Gate 2 review/publish spec.
 *
 * Refuses to touch anything but a local database.
 */
import { eq } from 'drizzle-orm'
import * as schema from '../lib/db/schema'
import { FIXTURE_MUNS } from './fixtures/fixture-muns'
import {
  ensureCommittee,
  ensureProduct,
  ensureVerifiedPaymentAccount,
  organizerId,
  recreateReadyToSubmitMun,
  resetSeededLogins,
  upsertMun,
  wipeRegistrations,
  withFixtureDb,
  type FixtureDb,
} from './fixtures/fixture-db'

async function main(db: FixtureDb): Promise<void> {
  await resetSeededLogins(db)
  // MUN Hub has no refunds. Older seeds created REFUND_POLICY documents; the
  // seed no longer does (fc45913), so clear leftovers from this local database.
  await db.delete(schema.munDocuments).where(eq(schema.munDocuments.kind, 'REFUND_POLICY'))
  const ownerId = await organizerId(db)
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

    const lifecycleId = await upsertMun(tx, ownerId, FIXTURE_MUNS.lifecycle, 'PUBLISHED')
    for (const p of FIXTURE_MUNS.lifecycle.products) await ensureProduct(tx, lifecycleId, p)
    await wipeRegistrations(tx, lifecycleId)
    await ensureVerifiedPaymentAccount(tx, lifecycleId)

    for (const def of [FIXTURE_MUNS.review, FIXTURE_MUNS.suspend, FIXTURE_MUNS.confirm, FIXTURE_MUNS.adminConsole]) await recreateReadyToSubmitMun(tx, ownerId, def)

    console.log(
      `[e2e] fixtures ready: ${FIXTURE_MUNS.review.slug} + ${FIXTURE_MUNS.suspend.slug} + ${FIXTURE_MUNS.confirm.slug} (recreated, all modules filled), ` +
        `${FIXTURE_MUNS.open.slug} (open, ${wiped} old registrations wiped), ` +
        `${FIXTURE_MUNS.sandbox.slug} (onboarding), ${FIXTURE_MUNS.closed.slug} (published, not open), ` +
        `${FIXTURE_MUNS.lifecycle.slug} (published, ready to open)`,
    )
  })
}

withFixtureDb(main).catch((error) => {
  console.error('[e2e] prepare-db failed:', error)
  process.exitCode = 1
})
