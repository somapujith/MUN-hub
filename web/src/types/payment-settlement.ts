export type PaymentVerificationState = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "FAILED";

/**
 * Mirrors lib/actions/payment-settlement.ts's `MaskedPaymentSettings` — this
 * type must never gain `panCiphertext`/`accountNumberCiphertext` fields (or
 * any full PAN/account number field). The server never returns them; there
 * is no decrypt-and-return path anywhere in this codebase.
 */
export interface MaskedPaymentSettings {
  id: string;
  munId: string;
  legalName: string;
  orgType: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  panLast4: string;
  gstin: string | null;
  authorizedRepName: string;
  authorizedRepEmail: string;
  accountHolderName: string;
  bankName: string;
  accountNumberLast4: string;
  ifsc: string;
  accountType: string;
  gateway: string;
  currency: string;
  refundPolicy: string | null;
  settlementNotes: string | null;
  verificationState: PaymentVerificationState;
  verifiedAt: string | null;
}

/**
 * Write-only input — `pan`/`accountNumber` are full plaintext values the
 * organizer must type in full on every save. The server never echoes them
 * back, so the form never pre-fills these two fields from a previous read.
 */
export interface UpsertPaymentSettingsInput {
  legalName: string;
  orgType: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  pan: string;
  gstin?: string | null;
  authorizedRepName: string;
  authorizedRepEmail: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  accountType: string;
  gateway: string;
  currency?: string;
  refundPolicy?: string | null;
  settlementNotes?: string | null;
}
