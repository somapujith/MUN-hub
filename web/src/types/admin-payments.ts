import type { PaymentStatus, RegistrationStatus } from "@/types/enums";

/**
 * Why a payment needs an admin — mirrors
 * `lib/payments/exception-reasons.ts#PAYMENT_EXCEPTION_REASONS`. Typed as a
 * string too so an unknown future reason still renders.
 */
export type PaymentExceptionReason =
  | "PAYMENT_AFTER_HOLD_EXPIRED"
  | "DUPLICATE_PAYMENT"
  | "AMOUNT_MISMATCH"
  | (string & {});

/** Mirrors `lib/payments/exceptions.ts#PaymentExceptionRow`, dates as ISO strings. */
export interface PaymentExceptionRow {
  paymentId: string;
  registrationId: string;
  reason: PaymentExceptionReason;
  amount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  registrationStatus: RegistrationStatus;
  providerOrderId: string;
  providerPaymentId: string | null;
  studentName: string;
  studentEmail: string;
  munName: string;
  raisedAt: string;
}

export interface ResolvedPaymentException {
  paymentId: string;
  reason: string;
  resolvedAt: string;
  resolvedBy: string;
  note: string;
}
