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
  /** Set only when `status: 'resolved'` was requested; null for an open row. */
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
}

export interface ListPaymentExceptionsParams {
  status?: "open" | "resolved";
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ListPaymentExceptionsResult {
  results: PaymentExceptionRow[];
  total: number;
}

export interface ResolvedPaymentException {
  paymentId: string;
  reason: string;
  resolvedAt: string;
  resolvedBy: string;
  note: string;
}

/** Mirrors `lib/payments/admin-reconcile.ts#PaymentReconcileOutcome`. */
export type PaymentReconcileOutcome =
  | "no_decisive_attempt"
  | "confirmed"
  | "duplicate"
  | "ignored"
  | "exception"
  | "failed"
  | "rejected";

/** Mirrors `lib/payments/admin-reconcile.ts#ReconcilePaymentResult`. */
export interface ReconcilePaymentResult {
  paymentId: string;
  providerOrderId: string;
  statusBefore: PaymentStatus;
  statusAfter: PaymentStatus;
  outcome: PaymentReconcileOutcome;
  message: string;
}

/** Mirrors `lib/payments/admin-reconcile.ts#PaymentTimelineEvent` (dates land as ISO strings over the wire). */
export interface PaymentTimelineEvent {
  id: string;
  eventType: string | null;
  outcome: string | null;
  receivedAt: string;
  processedAt: string | null;
}

/** Mirrors `lib/payments/admin-reconcile.ts#PaymentTimeline`. */
export interface PaymentTimeline {
  paymentId: string;
  registrationId: string;
  provider: string;
  providerOrderId: string;
  status: PaymentStatus;
  events: PaymentTimelineEvent[];
}
