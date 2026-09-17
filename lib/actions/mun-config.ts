import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { committees, muns, portfolios, registrationProducts } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { transitionMun } from '@/lib/lifecycle/mun-state-machine'
import { triggerReverificationIfNeeded } from '@/lib/lifecycle/reverification'
import type { Committee, Mun, Portfolio, RegistrationProduct } from '@/lib/types'

// -----------------------------------------------------------------------------
// Shared ownership check
// -----------------------------------------------------------------------------
//
// Every mutation in this file is gated by the same rule: the acting session
// must either be the owning organizer of the mun (walked up from
// committee -> mun or portfolio -> committee -> mun when the mutated row
// isn't the mun itself) or hold role ADMIN/SUPER_ADMIN. `assertOwnsOrAdmin`
// (see lib/auth/ownership.ts) is the single place that logic lives — do not
// re-implement it per entity.
//
// LOCKED enforcement (Task 12, design doc Section 9): COMMITTEES,
// PORTFOLIOS, REGISTRATION_TYPES/PRICING_CAPACITY, and BASIC_INFO/
// DATES_VENUE are all high-impact modules (non-empty HIGH_IMPACT_FIELDS —
// see reverification.ts), so every create/update/delete in this file that
// touches one of them calls `assertModuleNotLocked` FIRST, right after (or
// as part of) the ownership check, before touching any row. Admin/ops
// callers are unaffected — `assertModuleNotLocked` itself carves that out.
//
// Re-verification key fix (Task 12): the direct `triggerReverificationIfNeeded`
// calls below now pass the real PRD module key (`COMMITTEES`,
// `PRICING_CAPACITY`, `BASIC_INFO`) instead of the legacy pre-PRD key
// (`committees`, `registration_products`, `mun_details`). HIGH_IMPACT_FIELDS
// now correctly resolves every legacy key to an empty list (Task 12 Step 1),
// so a before/after diff keyed to a legacy key can never detect a real
// high-impact change anymore — it must be keyed to the PRD module whose
// HIGH_IMPACT_FIELDS entry actually lists the changed fields.

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
  await assertModuleNotLocked(input.munId, 'COMMITTEES', session)
  const [committee] = await db.insert(committees).values(input).returning()

  await onModuleDataChanged(input.munId, 'COMMITTEES', session!.userId)

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
  await assertModuleNotLocked(munId, 'COMMITTEES', session)

  const [existing] = await db.select().from(committees).where(eq(committees.id, id)).limit(1)
  if (!existing) throw new Error('Committee not found')

  const [updated] = await db.update(committees).set(input).where(eq(committees.id, id)).returning()
  if (!updated) throw new Error('Committee not found')

  // PRD key, not the legacy 'committees' key — see file header comment.
  await triggerReverificationIfNeeded('COMMITTEES', existing, updated, munId, session!.userId)
  await onModuleDataChanged(munId, 'COMMITTEES', session!.userId)

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
  await assertModuleNotLocked(munId, 'COMMITTEES', session)
  await db.delete(committees).where(eq(committees.id, id))

  await onModuleDataChanged(munId, 'COMMITTEES', session!.userId)
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

export const portfolioNameTaken = (name: string) => `A portfolio named "${name}" already exists in this committee`

const normalizePortfolioName = (name: string) => name.trim().toLowerCase()

/** Portfolio names must be unique within a committee (the PORTFOLIOS go-live check), ignoring case. */
async function assertPortfolioNamesFree(committeeId: string, names: string[], excludeId?: string): Promise<void> {
  const seen = new Set<string>()
  for (const name of names) {
    const key = normalizePortfolioName(name)
    if (seen.has(key)) throw new Error(portfolioNameTaken(name.trim()))
    seen.add(key)
  }
  const existing = await db
    .select({ id: portfolios.id, name: portfolios.name })
    .from(portfolios)
    .where(eq(portfolios.committeeId, committeeId))
  const clash = existing.find((row) => row.id !== excludeId && seen.has(normalizePortfolioName(row.name)))
  if (clash) throw new Error(portfolioNameTaken(clash.name))
}

export async function createPortfolio(input: CreatePortfolioInput, session: Session | null): Promise<Portfolio> {
  const munId = await getMunIdForCommittee(input.committeeId)
  await assertOwnsOrAdmin(munId, session)
  await assertModuleNotLocked(munId, 'PORTFOLIOS', session)
  const name = input.name.trim()
  if (!name) throw new Error('Portfolio name is required')
  await assertPortfolioNamesFree(input.committeeId, [name])
  const [portfolio] = await db.insert(portfolios).values({ ...input, name }).returning()

  await onModuleDataChanged(munId, 'PORTFOLIOS', session!.userId)

  return portfolio
}

export const MAX_PORTFOLIOS_PER_REQUEST = 300

/**
 * Adds many portfolios to one committee at once (e.g. a pasted country list).
 * All or nothing, and one progress recompute instead of one per portfolio.
 */
export async function createPortfolios(
  committeeId: string,
  items: Omit<CreatePortfolioInput, 'committeeId'>[],
  session: Session | null,
): Promise<Portfolio[]> {
  const munId = await getMunIdForCommittee(committeeId)
  await assertOwnsOrAdmin(munId, session)
  await assertModuleNotLocked(munId, 'PORTFOLIOS', session)

  const rows = items.map((item) => ({ ...item, committeeId, name: item.name.trim() }))
  if (rows.length === 0) throw new Error('Add at least one portfolio')
  if (rows.length > MAX_PORTFOLIOS_PER_REQUEST) {
    throw new Error(`You can add at most ${MAX_PORTFOLIOS_PER_REQUEST} portfolios at once`)
  }
  if (rows.some((row) => !row.name)) throw new Error('Portfolio name is required')
  await assertPortfolioNamesFree(
    committeeId,
    rows.map((row) => row.name),
  )

  const created = await db.insert(portfolios).values(rows).returning()
  await onModuleDataChanged(munId, 'PORTFOLIOS', session!.userId)
  return created
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
  await assertModuleNotLocked(munId, 'PORTFOLIOS', session)

  const [existing] = await db.select().from(portfolios).where(eq(portfolios.id, id)).limit(1)
  if (!existing) throw new Error('Portfolio not found')

  const changes = input.name === undefined ? input : { ...input, name: input.name.trim() }
  if (changes.name !== undefined) {
    if (!changes.name) throw new Error('Portfolio name is required')
    await assertPortfolioNamesFree(committeeId, [changes.name], id)
  }

  const [updated] = await db.update(portfolios).set(changes).where(eq(portfolios.id, id)).returning()
  if (!updated) throw new Error('Portfolio not found')

  await triggerReverificationIfNeeded('PORTFOLIOS', existing, updated, munId, session!.userId)
  await onModuleDataChanged(munId, 'PORTFOLIOS', session!.userId)

  return updated
}

/** Hard-deletes a portfolio — same reasoning as `deleteCommittee` above. */
export async function deletePortfolio(id: string, session: Session | null): Promise<void> {
  const committeeId = await getCommitteeIdForPortfolio(id)
  const munId = await getMunIdForCommittee(committeeId)
  await assertOwnsOrAdmin(munId, session)
  await assertModuleNotLocked(munId, 'PORTFOLIOS', session)
  await db.delete(portfolios).where(eq(portfolios.id, id))

  await onModuleDataChanged(munId, 'PORTFOLIOS', session!.userId)
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
  description?: string
  allowsIndividual?: boolean
  allowsDelegation?: boolean
  displayOrder?: number
  eligibility?: Record<string, unknown>
}

export async function createRegistrationProduct(
  input: CreateRegistrationProductInput,
  session: Session | null,
): Promise<RegistrationProduct> {
  await assertOwnsOrAdmin(input.munId, session)
  await assertModuleNotLocked(input.munId, 'REGISTRATION_TYPES', session)
  await assertModuleNotLocked(input.munId, 'PRICING_CAPACITY', session)
  const [product] = await db.insert(registrationProducts).values(input).returning()

  await onModuleDataChanged(input.munId, 'REGISTRATION_TYPES', session!.userId)
  await onModuleDataChanged(input.munId, 'PRICING_CAPACITY', session!.userId)

  return product
}

/**
 * Public read, no auth — same reasoning as `listCommittees`/`listPortfolios`
 * above. Defaults to active-only (a soft-deleted product shouldn't be
 * exposed to callers who forget to filter); pass `includeInactive: true`
 * for admin/organizer views that need to show archived products.
 */
export async function listRegistrationProducts(
  munId: string,
  options: { includeInactive?: boolean } = {},
): Promise<RegistrationProduct[]> {
  return db
    .select()
    .from(registrationProducts)
    .where(
      options.includeInactive
        ? eq(registrationProducts.munId, munId)
        : and(eq(registrationProducts.munId, munId), eq(registrationProducts.status, 'active')),
    )
}

export interface UpdateRegistrationProductInput {
  name?: string
  price?: number
  capacity?: number
  currency?: string
  deadline?: Date | null
  status?: string
  description?: string
  allowsIndividual?: boolean
  allowsDelegation?: boolean
  displayOrder?: number
  eligibility?: Record<string, unknown>
}

export async function updateRegistrationProduct(
  id: string,
  input: UpdateRegistrationProductInput,
  session: Session | null,
): Promise<RegistrationProduct> {
  const [existing] = await db
    .select()
    .from(registrationProducts)
    .where(eq(registrationProducts.id, id))
    .limit(1)
  if (!existing) throw new Error('Registration product not found')
  await assertOwnsOrAdmin(existing.munId, session)
  await assertModuleNotLocked(existing.munId, 'REGISTRATION_TYPES', session)
  await assertModuleNotLocked(existing.munId, 'PRICING_CAPACITY', session)

  const [updated] = await db
    .update(registrationProducts)
    .set(input)
    .where(eq(registrationProducts.id, id))
    .returning()
  if (!updated) throw new Error('Registration product not found')

  // PRD keys, not the legacy 'registration_products' key — see file header
  // comment. Both REGISTRATION_TYPES (name/registrationType/status) and
  // PRICING_CAPACITY (price/capacity/deadline/...) can be affected by this
  // same update, so both are checked against the real before/after diff.
  await triggerReverificationIfNeeded('REGISTRATION_TYPES', existing, updated, existing.munId, session!.userId)
  await triggerReverificationIfNeeded('PRICING_CAPACITY', existing, updated, existing.munId, session!.userId)
  await onModuleDataChanged(existing.munId, 'REGISTRATION_TYPES', session!.userId)
  await onModuleDataChanged(existing.munId, 'PRICING_CAPACITY', session!.userId)

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
  await assertModuleNotLocked(existing.munId, 'REGISTRATION_TYPES', session)
  await assertModuleNotLocked(existing.munId, 'PRICING_CAPACITY', session)

  await db.update(registrationProducts).set({ status: 'inactive' }).where(eq(registrationProducts.id, id))

  await onModuleDataChanged(existing.munId, 'REGISTRATION_TYPES', session!.userId)
  await onModuleDataChanged(existing.munId, 'PRICING_CAPACITY', session!.userId)
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
  addressLine1?: string | null
  addressState?: string | null
  postalCode?: string | null
  mapUrl?: string | null
  registrationOpensAt?: Date | null
  registrationDeadline?: Date | null
}

/**
 * Full mun row for the organizer's own setup/edit form (or admin). Unlike
 * `getMunBySlug` (lib/actions/marketplace.ts), this is deliberately NOT
 * filtered by publication status — an organizer must be able to see/edit
 * their own mun's details while it's still in any pre-publication lifecycle
 * state (DRAFT, ONBOARDING, CONTENT_SUBMITTED, etc), which is exactly when
 * this form is used most. Owning organizer or admin only, same gate as
 * `updateMunDetails` below.
 */
export async function getMunDetails(munId: string, session: Session | null): Promise<Mun> {
  await assertOwnsOrAdmin(munId, session)
  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  return mun
}

/** `muns` columns tracked by BASIC_INFO; every other details field is DATES_VENUE. */
const BASIC_INFO_FIELDS = new Set<string>(['name', 'edition', 'theme', 'description'])

function changedDetailFields(existing: Mun, input: UpdateMunDetailsInput): string[] {
  return Object.entries(input)
    .filter(([key, value]) => {
      if (value === undefined) return false
      const current = existing[key as keyof Mun] ?? null
      if (value instanceof Date || current instanceof Date) {
        return (value instanceof Date ? value.getTime() : value) !== (current instanceof Date ? current.getTime() : current)
      }
      return value !== current
    })
    .map(([key]) => key)
}

/**
 * Registration eligibility enforces the window, so an inverted one silently
 * closes registration. Checked only when this write touches one of the three
 * dates, against the values the row will have afterwards.
 */
function assertRegistrationWindow(existing: Mun, input: UpdateMunDetailsInput): void {
  const touched = ['registrationOpensAt', 'registrationDeadline', 'startDate'].some((key) => key in input)
  if (!touched) return
  const opensAt = 'registrationOpensAt' in input ? input.registrationOpensAt : existing.registrationOpensAt
  const deadline = 'registrationDeadline' in input ? input.registrationDeadline : existing.registrationDeadline
  const startDate = 'startDate' in input ? input.startDate : existing.startDate
  if (!deadline) return
  if (opensAt && opensAt.getTime() >= deadline.getTime()) {
    throw new Error('Registration deadline must be after registration opens')
  }
  if (startDate && deadline.getTime() >= startDate.getTime()) {
    throw new Error('Registration deadline must be before the conference starts')
  }
}

/** Updates the mun's own editable fields. Organizer-only (or admin) — never touches status. */
export async function updateMunDetails(
  munId: string,
  input: UpdateMunDetailsInput,
  session: Session | null,
): Promise<Mun> {
  await assertOwnsOrAdmin(munId, session)

  const [existing] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!existing) throw new Error('Mun not found')

  // BASIC_INFO and DATES_VENUE both back onto this same `muns` table update.
  // Lock-check only the module whose values actually change: the setup form
  // sends every field, and a reviewer may have sent back just one of the two.
  const changed = changedDetailFields(existing, input)
  if (changed.some((field) => BASIC_INFO_FIELDS.has(field))) {
    await assertModuleNotLocked(munId, 'BASIC_INFO', session)
  }
  if (changed.some((field) => !BASIC_INFO_FIELDS.has(field))) {
    await assertModuleNotLocked(munId, 'DATES_VENUE', session)
  }
  assertRegistrationWindow(existing, input)

  const [updated] = await db
    .update(muns)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(muns.id, munId))
    .returning()
  if (!updated) throw new Error('Mun not found')

  // PRD keys, not the legacy 'mun_details' key — see file header comment.
  // BASIC_INFO (name/edition) and DATES_VENUE (dates, venue, address, map
  // link, registration window — see HIGH_IMPACT_FIELDS in reverification.ts)
  // both back onto this same table, so both are checked against the real
  // before/after diff.
  await triggerReverificationIfNeeded('BASIC_INFO', existing, updated, munId, session!.userId)
  await triggerReverificationIfNeeded('DATES_VENUE', existing, updated, munId, session!.userId)

  // BASIC_INFO and DATES_VENUE both back onto this same `muns` table (design
  // doc Section 2.1/2.2 — one table, two tracked module rows), so a single
  // updateMunDetails call must recompute BOTH module rows, not just one.
  await onModuleDataChanged(munId, 'BASIC_INFO', session!.userId)
  await onModuleDataChanged(munId, 'DATES_VENUE', session!.userId)

  return updated
}

// -----------------------------------------------------------------------------
// Verification submission
// -----------------------------------------------------------------------------

/**
 * Moves a mun from CONTENT_SUBMITTED to VERIFICATION via the shared lifecycle
 * state machine (`transitionMun`), which validates each transition and writes
 * an audit row to `verificationLogs`. Organizer (owning) or admin only.
 *
 * As of the verification/confirmation trust layer
 * (docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md),
 * CONTENT_SUBMITTED no longer transitions directly to VERIFICATION — it
 * passes through ORGANIZER_CONFIRMATION first (PRD Gate 3). This function
 * now performs both hops so existing callers (the organizer dashboard's
 * "submit for verification" panel) keep working without a breaking API
 * change, but it does NOT create an `organizer_confirmations` snapshot row
 * the way `lib/lifecycle/organizer-confirmation.ts`'s `submitFinalConfirmation`
 * does — this is a lighter-weight compatibility shim, not the real Gate 3
 * flow. The organizer dashboard should be migrated to call
 * `submitFinalConfirmation` directly once its UI is updated to present the
 * full confirmation summary PRD Section 14 describes; this function can
 * likely be deleted at that point.
 */
export async function submitMunForVerification(munId: string, session: Session | null): Promise<Mun> {
  await assertOwnsOrAdmin(munId, session)
  if (!session) throw new Error('Forbidden')
  await transitionMun(munId, 'ORGANIZER_CONFIRMATION', session.userId)
  return transitionMun(munId, 'VERIFICATION', session.userId)
}
