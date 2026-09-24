import type { PaymentStatus, RegistrationStatus } from "@/types/enums";

/** Mirrors `lib/actions/admin-review.ts#RegistrationsQueueRow` (Date fields land as ISO strings over the wire). */
export interface AdminRegistrationRow {
  id: string;
  munId: string;
  delegateName: string;
  delegateEmail: string;
  munName: string;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus | null;
  flaggedDuplicateAt: Date | null;
  createdAt: Date;
}

export interface AdminRegistrationsQueueResult {
  results: AdminRegistrationRow[];
  total: number;
}

/** Mirrors `lib/actions/admin-review.ts#CancelRegistrationResult`. */
export interface AdminRegistrationCancelResult {
  id: string;
  status: RegistrationStatus;
}

/** Mirrors `lib/actions/admin-review.ts#SetDuplicateFlagResult` (Date lands as an ISO string over the wire). */
export interface AdminRegistrationDuplicateFlagResult {
  id: string;
  flaggedDuplicateAt: Date | null;
}

/** Mirrors `lib/actions/admin-review.ts#ResendConfirmationResult`. */
export interface AdminRegistrationResendResult {
  sent: boolean;
}
