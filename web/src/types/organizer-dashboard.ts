import type { PaymentStatus, RegistrationStatus } from "@/types/enums";

/**
 * Shapes returned by GET /organizer/muns/:munId/delegates
 * (lib/actions/organizer-dashboard.ts#getDelegateList). Narrowed to the
 * fields the Communications scaffold actually reads — the live response
 * carries the full row for each relation, TS structural typing just ignores
 * the rest.
 */
export interface DelegateUser {
  id: string;
  name: string;
  email: string;
  institution: string | null;
}

export interface DelegateCommittee {
  id: string;
  name: string;
}

export interface DelegatePayment {
  id: string;
  status: PaymentStatus;
  amount: number;
}

export interface DelegateRow {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  user: DelegateUser;
  committee: DelegateCommittee | null;
  payment: DelegatePayment[];
}

export interface DelegateListResult {
  results: DelegateRow[];
  total: number;
}
