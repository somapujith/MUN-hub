/** Staff console — mirrors lib/actions/admin-staff.ts. */

export type StaffRole = "OPERATIONS" | "ADMIN" | "SUPER_ADMIN";

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  suspended: boolean;
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
  /** False until the account's set-password link has been used. */
  passwordSet: boolean;
}

export interface ListStaffParams {
  q?: string;
  role?: StaffRole;
  limit?: number;
  offset?: number;
}

export interface ListStaffResult {
  results: StaffRow[];
  total: number;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  role: StaffRole;
}

export interface SetPasswordLink {
  setPasswordUrl: string;
  expiresAt: string;
}

export interface CreateStaffResult extends SetPasswordLink {
  staff: StaffRow;
}
