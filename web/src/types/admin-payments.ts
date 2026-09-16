/** Mirrors `lib/actions/admin-search.ts#PaymentExceptionRow` exactly. */
export interface PaymentExceptionRow {
  registrationId: string;
  paymentId: string;
  reason: "PAYMENT_FAILED" | "CONFIRMATION_MISMATCH";
  amount: number;
  studentName: string;
  munName: string;
}
