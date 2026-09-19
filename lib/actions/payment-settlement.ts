// -----------------------------------------------------------------------------
// payment-settlement — PAYMENT_SETTLEMENT module (PRD Section 19)
// -----------------------------------------------------------------------------
//
// SECURITY RULE — READ BEFORE EDITING THIS FILE:
// Every single database select statement in this file MUST list its columns
// explicitly by name. A bare `.select()` with no argument is BANNED in this
// file — `mun_payment_settings` carries `panCiphertext` and
// `accountNumberCiphertext`, and an unqualified select would include them in
// the result, defeating the entire masking design. See lib/db/schema.ts's
// comment above `munPaymentSettings` and design doc Section 2.3 / Section 8
// invariant #7 ("Payment plaintext is write-only, encrypted, and structurally
// unreachable by any read path").
//
// Masking design: the write path (`upsertPaymentSettings`) takes the full PAN
// and account number as plaintext, derives `last4`, encrypts the full value
// via `lib/crypto/field-encryption.ts`, and stores ciphertext + last4. It
// never echoes the plaintext or ciphertext back to the caller — the return
// value is always the `MaskedPaymentSettings` type, which structurally omits
// the ciphertext fields entirely (not just marks them optional). There is no
// decrypt-and-return action anywhere in this codebase (see field-encryption.ts).
//
// PAYMENT_SETTLEMENT is a high-impact module AND the single highest-
// consequence entry in the re-verification table (Task 12, design doc
// Section 6 — the fraud vector of swapping bank details post-approval).
// `upsertPaymentSettings` calls `assertModuleNotLocked` right after the
// ownership check, same as every other high-impact module's write path.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munPaymentSettings, payments, registrations } from '@/lib/db/schema'
import type { PaymentVerificationState, RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { encryptField } from '@/lib/crypto/field-encryption'
import { assertModuleNotLocked, onModuleDataChanged } from '@/lib/lifecycle/module-completion'
import { countedPaymentsFilter } from '@/lib/payments/counted-payments'

const PUBLISH_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

/**
 * Public-safe view of a mun's payment settlement configuration. Deliberately
 * does NOT declare `panCiphertext` or `accountNumberCiphertext` as fields at
 * all (not `?:`, not `| undefined` — structurally absent), so that adding one
 * of those columns to an object literal typed as `MaskedPaymentSettings` is a
 * compile error, not a runtime leak caught only by code review.
 */
export interface MaskedPaymentSettings {
  id: string
  munId: string
  legalName: string
  orgType: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  panLast4: string
  gstin: string | null
  authorizedRepName: string
  authorizedRepEmail: string
  accountHolderName: string
  bankName: string
  accountNumberLast4: string
  ifsc: string
  accountType: string
  gateway: string
  currency: string
  settlementNotes: string | null
  verificationState: PaymentVerificationState
  verifiedAt: Date | null
}

/** The explicit column list every select in this file must use. */
const MASKED_COLUMNS = {
  id: munPaymentSettings.id,
  munId: munPaymentSettings.munId,
  legalName: munPaymentSettings.legalName,
  orgType: munPaymentSettings.orgType,
  addressLine1: munPaymentSettings.addressLine1,
  addressLine2: munPaymentSettings.addressLine2,
  city: munPaymentSettings.city,
  state: munPaymentSettings.state,
  postalCode: munPaymentSettings.postalCode,
  panLast4: munPaymentSettings.panLast4,
  gstin: munPaymentSettings.gstin,
  authorizedRepName: munPaymentSettings.authorizedRepName,
  authorizedRepEmail: munPaymentSettings.authorizedRepEmail,
  accountHolderName: munPaymentSettings.accountHolderName,
  bankName: munPaymentSettings.bankName,
  accountNumberLast4: munPaymentSettings.accountNumberLast4,
  ifsc: munPaymentSettings.ifsc,
  accountType: munPaymentSettings.accountType,
  gateway: munPaymentSettings.gateway,
  currency: munPaymentSettings.currency,
  settlementNotes: munPaymentSettings.settlementNotes,
  verificationState: munPaymentSettings.verificationState,
  verifiedAt: munPaymentSettings.verifiedAt,
} as const

function last4(value: string): string {
  return value.slice(-4)
}

/**
 * The settlement identity + bank fields whose change invalidates MUNHub's
 * verification of this payout account. A superset of reverification.ts's
 * `HIGH_IMPACT_FIELDS.PAYMENT_SETTLEMENT` (which drives the MUN-level
 * re-verification flow): swapping the account holder, bank or account type
 * is the same "approved with a clean account, then swap in a different one"
 * fraud vector even though it doesn't move the MUN back through review.
 */
const SETTLEMENT_VERIFIED_FIELDS = [
  'legalName',
  'panLast4',
  'accountHolderName',
  'bankName',
  'accountNumberLast4',
  'ifsc',
  'accountType',
  'gateway',
  'currency',
] as const

type SettlementVerifiedField = (typeof SETTLEMENT_VERIFIED_FIELDS)[number]

function settlementSnapshot(row: Pick<MaskedPaymentSettings, SettlementVerifiedField>): Record<string, unknown> {
  return Object.fromEntries(SETTLEMENT_VERIFIED_FIELDS.map((field) => [field, row[field]]))
}

export interface UpsertPaymentSettingsInput {
  legalName: string
  orgType: string
  addressLine1: string
  addressLine2?: string | null
  city: string
  state: string
  postalCode: string
  pan: string
  gstin?: string | null
  authorizedRepName: string
  authorizedRepEmail: string
  accountHolderName: string
  bankName: string
  accountNumber: string
  ifsc: string
  accountType: string
  gateway: string
  currency?: string
  settlementNotes?: string | null
}

/**
 * Creates or replaces the one settlement-configuration row for `munId`.
 * Takes the full PAN and account number as plaintext input — the ONLY place
 * in this codebase that ever sees them — derives last4, encrypts the full
 * values, and returns only the masked view. The plaintext/ciphertext are
 * never returned, even though the caller just supplied the plaintext itself:
 * keeping "the server never returns full values" absolute makes it trivial
 * to audit (no code path anywhere returns these fields, full stop).
 *
 * This table has ~13 NOT NULL columns and is written in a single call by
 * design (see this task's report for the full nullability decision):
 * Organization/Bank/Payment configuration is treated as one combined
 * submission, consistent with PAYMENT_SETTLEMENT's HIGH_IMPACT_FIELDS
 * treating legalName/bank/gateway fields as one changed unit for
 * re-verification. Progressive "save as you go" completion for this module
 * is tracked independently via
 * `mun_module_verifications.completionStatus`/`completionPercentage` — a mun
 * can be IN_PROGRESS on PAYMENT_SETTLEMENT with zero rows in this table while
 * the organizer is still filling out the form; nothing requires a partial row
 * to exist here for that state to be represented.
 */
export async function upsertPaymentSettings(
  munId: string,
  input: UpsertPaymentSettingsInput,
  session: Session | null,
): Promise<MaskedPaymentSettings> {
  await assertOwnsOrAdmin(munId, session)
  await assertModuleNotLocked(munId, 'PAYMENT_SETTLEMENT', session)

  const panCiphertext = encryptField(input.pan)
  const accountNumberCiphertext = encryptField(input.accountNumber)

  const values = {
    munId,
    legalName: input.legalName,
    orgType: input.orgType,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    panLast4: last4(input.pan),
    panCiphertext,
    gstin: input.gstin ?? null,
    authorizedRepName: input.authorizedRepName,
    authorizedRepEmail: input.authorizedRepEmail,
    accountHolderName: input.accountHolderName,
    bankName: input.bankName,
    accountNumberLast4: last4(input.accountNumber),
    accountNumberCiphertext,
    ifsc: input.ifsc,
    accountType: input.accountType,
    gateway: input.gateway,
    currency: input.currency ?? 'INR',
    // `refundPolicy` is deliberately not written: MUN Hub has one platform-wide
    // no-refunds policy (/legal/refunds), so organizers no longer set their
    // own. The column stays for existing rows and is left untouched here.
    settlementNotes: input.settlementNotes ?? null,
    updatedAt: new Date(),
  }

  const row = await db.transaction(async (tx) => {
    // Row-locked so a concurrent upsert can't read the same "before" and let
    // one of the two changes keep the VERIFIED stamp.
    const [existing] = await tx
      .select(MASKED_COLUMNS)
      .from(munPaymentSettings)
      .where(eq(munPaymentSettings.munId, munId))
      .for('update')
      .limit(1)

    const before = existing ? settlementSnapshot(existing) : {}
    const after = settlementSnapshot(values)
    const accountChanged =
      existing != null && SETTLEMENT_VERIFIED_FIELDS.some((field) => before[field] !== after[field])

    // Independently of the MUN's status: an account MUNHub already looked at
    // must not stay VERIFIED once its details change — `open-registration`
    // (registration-lifecycle.ts) gates paid passes on exactly that value.
    // This is a payout-account check only; it never takes the MUN's listing
    // offline (a verified MUN's edits don't go back to review).
    const write = accountChanged
      ? { ...values, verificationState: 'PENDING' as const, verifiedAt: null, verifiedBy: null }
      : values

    const [saved] = await tx
      .insert(munPaymentSettings)
      .values(write)
      .onConflictDoUpdate({ target: munPaymentSettings.munId, set: write })
      .returning(MASKED_COLUMNS)

    return saved
  })

  await onModuleDataChanged(munId, 'PAYMENT_SETTLEMENT', session!.userId)

  return row
}

export interface MunPaymentsSummary {
  currency: string
  /** What delegates paid. */
  grossCollected: number
  /** MUN Hub's platform fee, included in `grossCollected`. */
  platformFee: number
  /** GST on the platform fee, included in `grossCollected`. */
  platformFeeTax: number
  /** What the organizer is owed: gross − fee − tax. */
  organizerNet: number
  paidRegistrations: number
}

// A paid registration that still stands. A PAID payment whose registration
// was never confirmed (a late payment) is money owed back, not revenue.
const STANDING_REGISTRATION_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'ATTENDED', 'NO_SHOW']

/**
 * Money collected for one MUN from PAID payments, split into platform fee,
 * fee tax and organizer net — one row per currency (normally just INR; an
 * empty list means nothing has been paid yet). Payments recorded before the
 * fee model existed carry no split and count as zero fee. Mock checkout
 * payments moved no money and count only while the mock adapter is active.
 * Owner or ADMIN/SUPER_ADMIN only (same rule as the settings above).
 */
export async function getMunPaymentsSummary(munId: string, session: Session | null): Promise<MunPaymentsSummary[]> {
  await assertOwnsOrAdmin(munId, session)

  const fee = sql`coalesce(${payments.platformFeeAmount}, 0)`
  const tax = sql`coalesce(${payments.platformFeeTaxAmount}, 0)`
  const rows = await db
    .select({
      currency: payments.currency,
      grossCollected: sql<string>`coalesce(sum(${payments.amount}), 0)::bigint`,
      platformFee: sql<string>`coalesce(sum(${fee}), 0)::bigint`,
      platformFeeTax: sql<string>`coalesce(sum(${tax}), 0)::bigint`,
      organizerNet: sql<string>`coalesce(sum(coalesce(${payments.organizerNetAmount}, ${payments.amount} - ${fee} - ${tax})), 0)::bigint`,
      paidRegistrations: sql<string>`count(*)::bigint`,
    })
    .from(payments)
    .innerJoin(registrations, eq(payments.registrationId, registrations.id))
    .where(
      and(
        eq(registrations.munId, munId),
        eq(payments.status, 'PAID'),
        inArray(registrations.status, STANDING_REGISTRATION_STATUSES),
        countedPaymentsFilter(),
      ),
    )
    .groupBy(payments.currency)
    .orderBy(payments.currency)

  return rows.map((row) => ({
    currency: row.currency,
    grossCollected: Number(row.grossCollected),
    platformFee: Number(row.platformFee),
    platformFeeTax: Number(row.platformFeeTax),
    organizerNet: Number(row.organizerNet),
    paidRegistrations: Number(row.paidRegistrations),
  }))
}

/**
 * Returns the masked settlement configuration for `munId`, or `null` if the
 * organizer hasn't submitted one yet. Callable by the owning organizer or
 * OPERATIONS/ADMIN/SUPER_ADMIN — same ownership rule as every other module.
 */
export async function getPaymentSettings(munId: string, session: Session | null): Promise<MaskedPaymentSettings | null> {
  await assertOwnsOrAdmin(munId, session)

  const [row] = await db
    .select(MASKED_COLUMNS)
    .from(munPaymentSettings)
    .where(eq(munPaymentSettings.munId, munId))
    .limit(1)

  return row ?? null
}

/**
 * Admin-only transition of `verificationState` (NOT_SUBMITTED/PENDING/
 * VERIFIED/FAILED), e.g. after an off-platform bank-account check. Restricted
 * to ADMIN/SUPER_ADMIN — stricter than the OPERATIONS-inclusive review bar
 * used elsewhere, because this gates whether real money can be settled to
 * this account. Row-locks the settings row and writes the `admin_actions`
 * row in the same transaction as the state change so the two can never
 * diverge.
 *
 * Deliberately does NOT call `onModuleDataChanged` — this is an admin review
 * action on an already-submitted module (PRD Section 19's off-platform
 * verification step), not organizer data entry. Re-triggering the
 * ONBOARDING/ACTION_REQUIRED/READY_FOR_SUBMISSION materialization from an
 * admin's verification decision would conflate the two axes this whole
 * design is built to keep separate (design doc Section 3.1) — see the task
 * brief's explicit carve-out for this function. Also deliberately does NOT
 * call `assertModuleNotLocked` — this IS the admin/reviewer action the lock
 * exists to still permit, not an organizer edit.
 *
 * Enum-value note (updated Task 11, 2026-09-14): now uses the dedicated
 * `PAYMENT_DETAILS_CHANGED` value on `adminActionEnum`, replacing the
 * `TICKET_RESOLVED` placeholder this function used before that value
 * existed (see git history for the original reasoning on why
 * `TICKET_RESOLVED` was the least-wrong stand-in).
 */
export async function setPaymentVerificationState(
  munId: string,
  state: PaymentVerificationState,
  session: Session | null,
): Promise<MaskedPaymentSettings> {
  requireRole(session, [...PUBLISH_ROLES])

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: munPaymentSettings.id })
      .from(munPaymentSettings)
      .where(eq(munPaymentSettings.munId, munId))
      .for('update')
      .limit(1)
    if (!existing) throw new Error('Payment settings not found for this mun')

    const [updated] = await tx
      .update(munPaymentSettings)
      .set({
        verificationState: state,
        verifiedAt: state === 'VERIFIED' ? new Date() : null,
        verifiedBy: state === 'VERIFIED' ? session.userId : null,
        updatedAt: new Date(),
      })
      .where(eq(munPaymentSettings.munId, munId))
      .returning(MASKED_COLUMNS)

    await recordAdminAction(tx, session.userId, 'PAYMENT_DETAILS_CHANGED', 'mun_payment_settings', munId, undefined, {
      newVerificationState: state,
    })

    return updated
  })
}
