export interface PaymentOrder {
  orderId: string
}

export interface RefundResult {
  providerRefundId: string
}

/**
 * Payments provider interface. Mock Razorpay-shaped implementation now; a
 * real Razorpay adapter implements the same interface later, call sites
 * unchanged.
 */
export interface PaymentsAdapter {
  createOrder(amount: number, currency: string, registrationId: string): Promise<PaymentOrder>
  verifyWebhookSignature(payload: string, signature: string): boolean
  /**
   * `idempotencyKey` should be a stable identifier for the refund attempt
   * (the `refund_requests.id` row, in this codebase) — real providers like
   * Razorpay accept an idempotency key precisely so that retrying the same
   * logical refund (e.g. after a network timeout where the caller can't
   * tell if the first call landed) never double-charges/double-refunds on
   * the provider's side. The mock adapter just logs/stores it, but the
   * parameter is wired through now so a real adapter can use it without an
   * interface change later.
   */
  refund(providerPaymentId: string, amount: number, idempotencyKey: string): Promise<RefundResult>
}
