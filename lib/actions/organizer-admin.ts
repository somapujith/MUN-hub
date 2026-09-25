import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, organizerProfiles, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { recordAdminAction } from '@/lib/audit/log'
import { decryptField } from '@/lib/crypto/field-encryption'
import type { User } from '@/lib/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type OrganizerRow = Pick<
  User,
  'id' | 'name' | 'email' | 'institution' | 'suspended' | 'suspendedReason' | 'suspendedAt' | 'createdAt'
> & {
  /**
   * How many MUNs this organizer runs (any status). A per-row subquery, same
   * pattern as `seatedRegistrations`/`pendingRegistrations` in
   * lib/actions/admin-muns.ts — cheap because a page is at most 100 rows.
   * Lets the Organizers console link through to the Conferences console
   * pre-filtered by `organizerId` instead of listing every MUN inline here.
   */
  munCount: number
}

export interface ListOrganizersParams {
  limit?: number
  offset?: number
  // Case-insensitive substring match against name OR email. Added
  // 2026-09-17 — this was previously a documented gap (see
  // organizer-admin.test.ts's `listOrganizers` describe block); the admin
  // organizer directory page needs it to be usable once seed/real data
  // volume grows past a single page.
  search?: string
}

export interface ListOrganizersResult {
  results: OrganizerRow[]
  total: number
}

/**
 * Paginated list of organizer accounts (role = ORGANIZER only), for the
 * admin organizer-management console. Requires OPERATIONS/ADMIN/SUPER_ADMIN
 * — actor is derived from the caller-supplied `session`, never accepted as
 * a client-trusted value.
 *
 * Same pagination reasoning as `getReviewQueue`/`getModuleReviewQueue`
 * (lib/actions/admin-review.ts): this grows with total organizer count, not
 * per-mun, so it needs a bound before real platform volume.
 */
export async function listOrganizers(
  params: ListOrganizersParams = {},
  session: Session | null,
): Promise<ListOrganizersResult> {
  requireRole(session, [...ADMIN_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const trimmedSearch = params.search?.trim()
  const whereClause = trimmedSearch
    ? and(
        eq(users.role, 'ORGANIZER'),
        or(ilike(users.name, `%${trimmedSearch}%`), ilike(users.email, `%${trimmedSearch}%`)),
      )
    : eq(users.role, 'ORGANIZER')

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      institution: users.institution,
      suspended: users.suspended,
      suspendedReason: users.suspendedReason,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(users.name)
    .limit(limit)
    .offset(offset)

  // Deliberately a second query merged in JS, not a per-row correlated
  // subquery: this query's outer FROM is `users` alone (no join), which
  // trips Drizzle's `isSingleTable` optimization (pg-core/dialect.js
  // `buildSelection`) — it strips table qualifiers from EVERY column inside
  // a raw `sql` field whenever the outer query has no joins, including
  // columns from an unrelated table referenced in a correlated subquery.
  // That silently turned `muns.organizer_id = users.id` into
  // `"organizer_id" = "id"`, which Postgres resolves entirely inside the
  // subquery's own scope (muns.id) — always false, so munCount was always 0
  // with no SQL error. `admin-muns.ts`'s equivalent per-row subqueries avoid
  // this because that query has an `innerJoin`, which disables the
  // optimization. Same shape as `getGoLiveQueueDetails`'s `bySubmission` map.
  const munCounts =
    rows.length === 0
      ? []
      : await db
          .select({ organizerId: muns.organizerId, count: sql<number>`count(*)::int` })
          .from(muns)
          .where(
            inArray(
              muns.organizerId,
              rows.map((row) => row.id),
            ),
          )
          .groupBy(muns.organizerId)
  const countByOrganizer = new Map(munCounts.map((row) => [row.organizerId, row.count]))
  const results = rows.map((row) => ({ ...row, munCount: countByOrganizer.get(row.id) ?? 0 }))

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(whereClause)

  return { results, total: count }
}

/** Thrown when the target id is not an ORGANIZER account (the API maps it to 404). */
export const ORGANIZER_NOT_FOUND = 'Organizer not found'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Row-locks the target user inside `tx` and throws `ORGANIZER_NOT_FOUND`
 * unless it exists AND has role ORGANIZER. Suspend/reinstate here are open to
 * OPERATIONS, so without this check an OPERATIONS account could suspend (or
 * reinstate) an ADMIN/SUPER_ADMIN just by passing that user's id. Staff
 * accounts are managed only through lib/actions/admin-staff.ts, which is
 * SUPER_ADMIN-only. A non-organizer id reads as "not found", not "forbidden",
 * so this endpoint can't be used to probe which ids belong to staff.
 */
async function lockOrganizer(tx: Tx, userId: string): Promise<void> {
  const [target] = await tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1)
  if (!target || target.role !== 'ORGANIZER') {
    throw new Error(ORGANIZER_NOT_FOUND)
  }
}

/**
 * Blocks an organizer's login (`getSession`/`signIn` already reject
 * suspended users — see lib/auth/session.ts and lib/actions/auth.ts).
 * Deliberately does NOT cascade to the organizer's MUNs: a suspension is an
 * account-level login block, not a content takedown — an admin unpublishes
 * or suspends a specific MUN separately if the content itself is the
 * problem. Requires OPERATIONS/ADMIN/SUPER_ADMIN, and only ever acts on an
 * ORGANIZER account (see `lockOrganizer`).
 */
export async function suspendOrganizer(userId: string, reason: string, session: Session | null): Promise<void> {
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await lockOrganizer(tx, userId)

    await tx
      .update(users)
      .set({ suspended: true, suspendedReason: reason, suspendedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, 'ORGANIZER')))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_SUSPENDED', 'user', userId, reason)
  })
}

/**
 * Clears a suspension, restoring the organizer's login access. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN, and only ever acts on an ORGANIZER account
 * (see `lockOrganizer`) — a suspended staff account is reinstated through
 * lib/actions/admin-staff.ts instead.
 */
export async function reinstateOrganizer(userId: string, session: Session | null): Promise<void> {
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await lockOrganizer(tx, userId)

    await tx
      .update(users)
      .set({ suspended: false, suspendedReason: null, suspendedAt: null })
      .where(and(eq(users.id, userId), eq(users.role, 'ORGANIZER')))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_REINSTATED', 'user', userId)
  })
}

export interface OrganizerProfileDetail {
  firstName: string | null
  lastName: string | null
  contactPhone: string | null
  /** The organizer's first MUN, answered in the onboarding wizard. */
  munName: string | null
  munCity: string | null
  /** ISO date (YYYY-MM-DD). */
  munStartDate: string | null
  expectedDelegateCount: number | null
  munDescription: string | null
  previousEditions: string | null
  websiteUrl: string | null
  agreementVersion: string | null
  completedAt: Date | null
  /** Account-level payout status — see `verifyOrganizerPayout` below. Never the bank account number itself (see `OrganizerBankDetails`, revealed separately). */
  payoutVerified: boolean
  paymentGateway: string | null
  payoutVerifiedAt: Date | null
}

export interface OrganizerDetail {
  id: string
  name: string
  email: string
  institution: string | null
  suspended: boolean
  suspendedReason: string | null
  suspendedAt: Date | null
  createdAt: Date
  /** Onboarding-wizard answers, or null if the organizer hasn't started onboarding. */
  profile: OrganizerProfileDetail | null
}

/**
 * Full "everything this organizer entered" admin view for the organizer
 * detail page: account fields plus their onboarding-wizard answers
 * (name/phone, first MUN's answers) and their payout-verification status.
 * Deliberately excludes the bank account number itself — that stays behind
 * `getOrganizerBankDetails`'s separate reveal-on-click endpoint below, and is
 * never bundled into a plain GET. Requires OPERATIONS/ADMIN/SUPER_ADMIN, and
 * only ever acts on an ORGANIZER account (see `lockOrganizer`'s reasoning) —
 * a non-organizer id reads as "not found", not "forbidden". Read-only and
 * not audit-logged (unlike `getOrganizerBankDetails` — nothing sensitive is
 * returned here).
 */
export async function getOrganizerDetail(userId: string, session: Session | null): Promise<OrganizerDetail> {
  requireRole(session, [...ADMIN_ROLES])

  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      institution: users.institution,
      suspended: users.suspended,
      suspendedReason: users.suspendedReason,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!target || target.role !== 'ORGANIZER') throw new Error(ORGANIZER_NOT_FOUND)

  const [row] = await db
    .select({
      firstName: organizerProfiles.firstName,
      lastName: organizerProfiles.lastName,
      contactPhone: organizerProfiles.contactPhone,
      munName: organizerProfiles.munName,
      munCity: organizerProfiles.munCity,
      munStartDate: organizerProfiles.munStartDate,
      expectedDelegateCount: organizerProfiles.expectedDelegateCount,
      munDescription: organizerProfiles.munDescription,
      previousEditions: organizerProfiles.previousEditions,
      websiteUrl: organizerProfiles.websiteUrl,
      agreementVersion: organizerProfiles.agreementVersion,
      completedAt: organizerProfiles.completedAt,
      payoutVerified: organizerProfiles.payoutVerified,
      paymentGateway: organizerProfiles.paymentGateway,
      payoutVerifiedAt: organizerProfiles.payoutVerifiedAt,
    })
    .from(organizerProfiles)
    .where(eq(organizerProfiles.userId, userId))
    .limit(1)

  return {
    id: target.id,
    name: target.name,
    email: target.email,
    institution: target.institution,
    suspended: target.suspended,
    suspendedReason: target.suspendedReason,
    suspendedAt: target.suspendedAt,
    createdAt: target.createdAt,
    profile: row
      ? {
          firstName: row.firstName,
          lastName: row.lastName,
          contactPhone: row.contactPhone,
          munName: row.munName,
          munCity: row.munCity,
          munStartDate: row.munStartDate ? row.munStartDate.toISOString().slice(0, 10) : null,
          expectedDelegateCount: row.expectedDelegateCount,
          munDescription: row.munDescription,
          previousEditions: row.previousEditions,
          websiteUrl: row.websiteUrl,
          agreementVersion: row.agreementVersion,
          completedAt: row.completedAt,
          payoutVerified: row.payoutVerified,
          paymentGateway: row.paymentGateway,
          payoutVerifiedAt: row.payoutVerifiedAt,
        }
      : null,
  }
}

export interface OrganizerBankDetails {
  accountHolderName: string | null
  bankName: string | null
  /** Decrypted in full — see the function doc below before adding another caller. */
  bankAccountNumber: string | null
  ifscCode: string | null
  /** Optional secondary payout address (lib/actions/organizer-onboarding.ts). */
  upiId: string | null
  upiPhone: string | null
}

/**
 * Decrypts and returns an organizer's full payout bank details, so staff can
 * manually add them as a payout beneficiary in the real payment gateway
 * (Cashfree) — there is no automated settlement/payout integration yet (see
 * CLAUDE.md's deferred list). This is the one deliberate, audited exception
 * to the write-only rule lib/crypto/field-encryption.ts documents for the
 * PAYMENT_FIELD_KEY domain (2026-09-26, explicit user instruction — read
 * that file's `decryptField` doc comment before adding a second call site).
 *
 * Every call records an `ORGANIZER_BANK_DETAILS_REVEALED` admin_actions row
 * BEFORE returning the plaintext, unconditionally once the target is
 * confirmed to be an ORGANIZER — matching suspend/reinstate's
 * action-then-log shape, not the search-oriented recordPiiRead pattern (this
 * is a single, deliberate targeted reveal, not a list that may disclose
 * nothing). Requires OPERATIONS/ADMIN/SUPER_ADMIN, and only ever acts on an
 * ORGANIZER account (see `lockOrganizer`'s reasoning) — a non-organizer id
 * reads as "not found", not "forbidden".
 */
export async function getOrganizerBankDetails(userId: string, session: Session | null): Promise<OrganizerBankDetails> {
  requireRole(session, [...ADMIN_ROLES])

  const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  if (!target || target.role !== 'ORGANIZER') throw new Error(ORGANIZER_NOT_FOUND)

  const [row] = await db
    .select({
      accountHolderName: organizerProfiles.accountHolderName,
      bankName: organizerProfiles.bankName,
      bankAccountNumberCiphertext: organizerProfiles.bankAccountNumberCiphertext,
      ifscCode: organizerProfiles.ifscCode,
      upiId: organizerProfiles.upiId,
      upiPhone: organizerProfiles.upiPhone,
    })
    .from(organizerProfiles)
    .where(eq(organizerProfiles.userId, userId))
    .limit(1)

  await recordAdminAction(db, session.userId, 'ORGANIZER_BANK_DETAILS_REVEALED', 'user', userId)

  return {
    accountHolderName: row?.accountHolderName ?? null,
    bankName: row?.bankName ?? null,
    bankAccountNumber: row?.bankAccountNumberCiphertext ? decryptField(row.bankAccountNumberCiphertext) : null,
    ifscCode: row?.ifscCode ?? null,
    upiId: row?.upiId ?? null,
    upiPhone: row?.upiPhone ?? null,
  }
}

// -----------------------------------------------------------------------------
// Payout verification (2026-09-26, explicit user instruction) — the
// account-level gate that lets an organizer self-publish without a further
// admin Gate-2 step. See lib/lifecycle/go-live.ts#organizerSelfPublish for
// the consuming side.
// -----------------------------------------------------------------------------

/**
 * Which real payment gateway account staff manually set the organizer up as
 * a beneficiary in — there is no automated settlement integration (CLAUDE.md
 * deferred list), so this is a record of a real, out-of-band action, not a
 * live provider selection. `MANUAL` covers a plain bank transfer with no
 * gateway involved. Kept as a fixed list (not free text) so the web
 * dropdown and the server validation can never drift.
 */
export const PAYMENT_GATEWAY_OPTIONS = ['CASHFREE', 'MANUAL'] as const
export type PaymentGateway = (typeof PAYMENT_GATEWAY_OPTIONS)[number]

export const PAYOUT_VERIFICATION_ERRORS = {
  bankDetailsMissing: "This organizer hasn't submitted bank payout details yet",
} as const

export interface OrganizerPayoutStatus {
  payoutVerified: boolean
  paymentGateway: string | null
  payoutVerifiedAt: Date | null
}

/**
 * Marks an organizer's payout verified and records which gateway they were
 * tied to — the one deliberate admin action that then lets
 * `lib/lifecycle/go-live.ts#organizerSelfPublish` skip every further Gate-2
 * admin step for that organizer's MUNs. Requires the organizer to have
 * already filled in bank details (accountHolderName/bankName/
 * bankAccountLast4/ifscCode) — verifying an empty profile would be a lie.
 * Requires OPERATIONS/ADMIN/SUPER_ADMIN, and only ever acts on an ORGANIZER
 * account (see `lockOrganizer`'s reasoning — a non-organizer id reads as
 * "not found", not "forbidden"). Idempotent: verifying an already-verified
 * organizer again just updates `paymentGateway`/`payoutVerifiedAt`/
 * `payoutVerifiedBy` and logs another audit row — there's no "already
 * verified" error, since staff may legitimately re-confirm or switch gateways.
 */
export async function verifyOrganizerPayout(
  userId: string,
  gateway: PaymentGateway,
  session: Session | null,
): Promise<OrganizerPayoutStatus> {
  requireRole(session, [...ADMIN_ROLES])

  const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  if (!target || target.role !== 'ORGANIZER') throw new Error(ORGANIZER_NOT_FOUND)

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        accountHolderName: organizerProfiles.accountHolderName,
        bankName: organizerProfiles.bankName,
        bankAccountLast4: organizerProfiles.bankAccountLast4,
        ifscCode: organizerProfiles.ifscCode,
      })
      .from(organizerProfiles)
      .where(eq(organizerProfiles.userId, userId))
      .limit(1)
    if (!profile?.accountHolderName || !profile.bankName || !profile.bankAccountLast4 || !profile.ifscCode) {
      throw new Error(PAYOUT_VERIFICATION_ERRORS.bankDetailsMissing)
    }

    const now = new Date()
    const [updated] = await tx
      .update(organizerProfiles)
      .set({ payoutVerified: true, paymentGateway: gateway, payoutVerifiedAt: now, payoutVerifiedBy: session.userId })
      .where(eq(organizerProfiles.userId, userId))
      .returning({ payoutVerified: organizerProfiles.payoutVerified, paymentGateway: organizerProfiles.paymentGateway })

    await recordAdminAction(tx, session.userId, 'ORGANIZER_PAYOUT_VERIFIED', 'user', userId, undefined, { gateway })

    return { payoutVerified: updated.payoutVerified, paymentGateway: updated.paymentGateway, payoutVerifiedAt: now }
  })
}
