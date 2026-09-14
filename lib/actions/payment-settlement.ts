'use server'

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

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munPaymentSettings } from '@/lib/db/schema'
import type { PaymentVerificationState } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import { encryptField } from '@/lib/crypto/field-encryption'
import { onModuleDataChanged } from '@/lib/lifecycle/module-completion'

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
  refundPolicy: string | null
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
  refundPolicy: munPaymentSettings.refundPolicy,
  settlementNotes: munPaymentSettings.settlementNotes,
  verificationState: munPaymentSettings.verificationState,
  verifiedAt: munPaymentSettings.verifiedAt,
} as const

function last4(value: string): string {
  return value.slice(-4)
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
  refundPolicy?: string | null
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
    refundPolicy: input.refundPolicy ?? null,
    settlementNotes: input.settlementNotes ?? null,
    updatedAt: new Date(),
  }

  const [row] = await db
    .insert(munPaymentSettings)
    .values(values)
    .onConflictDoUpdate({
      target: munPaymentSettings.munId,
      set: values,
    })
    .returning(MASKED_COLUMNS)

  await onModuleDataChanged(munId, 'PAYMENT_SETTLEMENT', session!.userId)

  return row
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
 * brief's explicit carve-out for this function.
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
