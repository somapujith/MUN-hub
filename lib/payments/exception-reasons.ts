/**
 * Why a payment needs an admin (stored in `payments.exception_reason`).
 * There are no refunds in MUN Hub: these are payment ERRORS — money taken
 * with no valid registration behind it — which an admin resolves by hand
 * (see /legal/refunds, "The one exception: payment errors").
 */
export const PAYMENT_EXCEPTION_REASONS = {
  /** Captured after the seat hold expired or was released. */
  paymentAfterHoldExpired: 'PAYMENT_AFTER_HOLD_EXPIRED',
  /** A second, distinct capture on an order that was already paid. */
  duplicatePayment: 'DUPLICATE_PAYMENT',
  /** Captured amount or currency differs from the order. Not confirmed. */
  amountMismatch: 'AMOUNT_MISMATCH',
} as const

export type PaymentExceptionReason = (typeof PAYMENT_EXCEPTION_REASONS)[keyof typeof PAYMENT_EXCEPTION_REASONS]
