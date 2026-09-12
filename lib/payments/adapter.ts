export interface PaymentOrder {
  orderId: string
}

/**
 * Payments provider interface. Mock Razorpay-shaped implementation now; a
 * real Razorpay adapter implements the same interface later, call sites
 * unchanged.
 */
export interface PaymentsAdapter {
  createOrder(amount: number, currency: string, registrationId: string): Promise<PaymentOrder>
  verifyWebhookSignature(payload: string, signature: string): boolean
}
