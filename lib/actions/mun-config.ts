'use server'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, portfolios, registrationProducts } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import type { Committee, Mun, Portfolio, RegistrationProduct } from '@/lib/types'

// -----------------------------------------------------------------------------
// Shared ownership check
// -----------------------------------------------------------------------------
//
// Every mutation in this file is gated by the same rule: the acting session
// must either be the owning organizer of the mun (walked up from
// committee -> mun or portfolio -> committee -> mun when the mutated row
// isn't the mun itself) or hold role ADMIN/SUPER_ADMIN. This helper is the
// single place that logic lives — do not re-implement it per entity.

/**
 * Throws `Error('Forbidden')` unless `session` is non-null and is either an
 * ADMIN/SUPER_ADMIN or the organizer that owns `munId` (`mun.organizerId ===
 * session.userId`). Throws `Error('Mun not found')` if `munId` doesn't
 * resolve to a real row (fail fast on a bad id rather than silently denying).
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

/** Resolves a committee's owning munId, or throws `Error('Committee not found')`. */
async function getMunIdForCommittee(committeeId: string): Promise<string> {
  const [committee] = await db
    .select({ munId: committees.munId })
    .from(committees)
    .where(eq(committees.id, committeeId))
    .limit(1)
  if (!committee) throw new Error('Committee not found')
  return committee.munId
}

/** Resolves a portfolio's owning committeeId, or throws `Error('Portfolio not found')`. */
async function getCommitteeIdForPortfolio(portfolioId: string): Promise<string> {
  const [portfolio] = await db
    .select({ committeeId: portfolios.committeeId })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1)
  if (!portfolio) throw new Error('Portfolio not found')
  return portfolio.committeeId
}

// -----------------------------------------------------------------------------
// Committees
// -----------------------------------------------------------------------------

export interface CreateCommitteeInput {
  munId: string
  name: string
  agenda?: string
  description?: string
  capacity: number
}

export async function createCommittee(input: CreateCommitteeInput, session: Session | null): Promise<Committee> {
  await assertOwnsOrAdmin(input.munId, session)
  const [committee] = await db.insert(committees).values(input).returning()
  return committee
}

export interface UpdateCommitteeInput {
  name?: string
  agenda?: string
  description?: string
  capacity?: number
}

export async function updateCommittee(
  id: string,
  input: UpdateCommitteeInput,
  session: Session | null,
): Promise<Committee> {
  const munId = await getMunIdForCommittee(id)
  await assertOwnsOrAdmin(munId, session)

  const [updated] = await db.update(committees).set(input).where(eq(committees.id, id)).returning()
  if (!updated) throw new Error('Committee not found')
  return updated
}

/**
 * Hard-deletes a committee. Unlike registration products, committees/
 * portfolios have no downstream financial record (a `registrations` row
 * references them but only via a nullable FK, not a payment-bearing one) so
 * a real delete is safe here — see the registration-product section below
 * for why that entity gets a soft-delete instead.
 */
export async function deleteCommittee(id: string, session: Session | null): Promise<void> {
  const munId = await getMunIdForCommittee(id)
  await assertOwnsOrAdmin(munId, session)
  await db.delete(committees).where(eq(committees.id, id))
}

/**
 * Public read, no auth — used by the marketplace/detail pages as well as the
 * organizer dashboard. Deliberately lives here (not `marketplace.ts`)
 * because it is unfiltered by mun status: `getMunBySlug` in `marketplace.ts`
 * only returns committees for publicly-visible muns, but the organizer
 * dashboard must list committees for a mun in any lifecycle state (DRAFT,
 * UNDER_REVIEW, etc). Keeping CRUD + list together for the same entities in
 * one file also avoids splitting organizer-dashboard reads across two files.
 */
export async function listCommittees(munId: string): Promise<Committee[]> {
  return db.select().from(committees).where(eq(committees.munId, munId))
}

// -----------------------------------------------------------------------------
// Portfolios
// -----------------------------------------------------------------------------

export interface CreatePortfolioInput {
  committeeId: string
  name: string
  type?: string
  availability?: number
}

export async function createPortfolio(input: CreatePortfolioInput, session: Session | null): Promise<Portfolio> {
  const munId = await getMunIdForCommittee(input.committeeId)
  await assertOwnsOrAdmin(munId, session)
  const [portfolio] = await db.insert(portfolios).values(input).returning()
  return portfolio
}

export interface UpdatePortfolioInput {
  name?: string
  type?: string
  availability?: number
}

export async function updatePortfolio(
  id: string,
  input: UpdatePortfolioInput,
  session: Session | null,
): Promise<Portfolio> {
  const committeeId = await getCommitteeIdForPortfolio(id)
  const munId = await getMunIdForCommittee(committeeId)
  await assertOwnsOrAdmin(munId, session)

  const [updated] = await db.update(portfolios).set(input).where(eq(portfolios.id, id)).returning()
  if (!updated) throw new Error('Portfolio not found')
  return updated
}

/** Hard-deletes a portfolio — same reasoning as `deleteCommittee` above. */
export async function deletePortfolio(id: string, session: Session | null): Promise<void> {
  const committeeId = await getCommitteeIdForPortfolio(id)
  const munId = await getMunIdForCommittee(committeeId)
  await assertOwnsOrAdmin(munId, session)
  await db.delete(portfolios).where(eq(portfolios.id, id))
}

/** Public read, no auth — same reasoning as `listCommittees` above. */
export async function listPortfolios(committeeId: string): Promise<Portfolio[]> {
  return db.select().from(portfolios).where(eq(portfolios.committeeId, committeeId))
}

// -----------------------------------------------------------------------------
// Registration products
// -----------------------------------------------------------------------------

export interface CreateRegistrationProductInput {
  munId: string
  name: string
  price: number
  capacity: number
  currency?: string
  deadline?: Date
}

export async function createRegistrationProduct(
  input: CreateRegistrationProductInput,
  session: Session | null,
): Promise<RegistrationProduct> {
  await assertOwnsOrAdmin(input.munId, session)
  const [product] = await db.insert(registrationProducts).values(input).returning()
  return product
}

export interface UpdateRegistrationProductInput {
  name?: string
  price?: number
  capacity?: number
  currency?: string
  deadline?: Date | null
  status?: string
}

export async function updateRegistrationProduct(
  id: string,
  input: UpdateRegistrationProductInput,
  session: Session | null,
): Promise<RegistrationProduct> {
  const [existing] = await db
    .select({ munId: registrationProducts.munId })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, id))
    .limit(1)
  if (!existing) throw new Error('Registration product not found')
  await assertOwnsOrAdmin(existing.munId, session)

  const [updated] = await db
    .update(registrationProducts)
    .set(input)
    .where(eq(registrationProducts.id, id))
    .returning()
  if (!updated) throw new Error('Registration product not found')
  return updated
}

/**
 * SOFT-DELETE, not a real DB delete.
 *
 * Decision: registration products are referenced by `registrations` rows via
 * a NOT NULL FK (`registrations.registrationProductId`), and registrations
 * in turn carry payment records — a hard delete of a product that already
 * has registrations against it would either violate that FK constraint or
 * (if cascaded) silently destroy paid registration history. Flipping
 * `status` to `'inactive'` preserves referential integrity and audit trail
 * while removing the product from default/active listings. `listCommittees`
 * and `listPortfolios` above don't need this treatment because nothing with
 * a financial record depends on a committee/portfolio row continuing to
 * exist (see the hard-delete comments on those functions).
 */
export async function deleteRegistrationProduct(id: string, session: Session | null): Promise<void> {
  const [existing] = await db
    .select({ munId: registrationProducts.munId })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, id))
    .limit(1)
  if (!existing) throw new Error('Registration product not found')
  await assertOwnsOrAdmin(existing.munId, session)

  await db.update(registrationProducts).set({ status: 'inactive' }).where(eq(registrationProducts.id, id))
}

// -----------------------------------------------------------------------------
// Mun details
// -----------------------------------------------------------------------------

export interface UpdateMunDetailsInput {
  name?: string
  edition?: string | null
  theme?: string | null
  description?: string | null
  startDate?: Date | null
  endDate?: Date | null
  venue?: string | null
  city?: string | null
  country?: string | null
}

/** Updates the mun's own editable fields. Organizer-only (or admin) — never touches status. */
export async function updateMunDetails(
  munId: string,
  input: UpdateMunDetailsInput,
  session: Session | null,
): Promise<Mun> {
  await assertOwnsOrAdmin(munId, session)

  const [updated] = await db
    .update(muns)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(muns.id, munId))
    .returning()
  if (!updated) throw new Error('Mun not found')
  return updated
}

// -----------------------------------------------------------------------------
// Verification submission
// -----------------------------------------------------------------------------

/**
 * Moves a mun from CONTENT_SUBMITTED to VERIFICATION via the shared lifecycle
 * state machine (`transitionMun`), which validates the transition and writes
 * the audit row to `verificationLogs`. Organizer (owning) or admin only.
 */
export async function submitMunForVerification(munId: string, session: Session | null): Promise<Mun> {
  await assertOwnsOrAdmin(munId, session)
  if (!session) throw new Error('Forbidden')
  return transitionMun(munId, 'VERIFICATION', session.userId)
}
