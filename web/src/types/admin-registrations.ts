import type { PaymentStatus, RegistrationStatus } from "@/types/enums";

/** Mirrors `lib/actions/admin-review.ts#RegistrationsQueueRow` (Date fields land as ISO strings over the wire). */
export interface AdminRegistrationRow {
  id: string;
  delegateName: string;
  delegateEmail: string;
  munName: string;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus | null;
  createdAt: Date;
}

export interface AdminRegistrationsQueueResult {
  results: AdminRegistrationRow[];
  total: number;
}
