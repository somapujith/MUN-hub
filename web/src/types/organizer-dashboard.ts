import type { MunStatus, PaymentStatus, RegistrationStatus } from "@/types/enums";

/**
 * Shapes returned by the organizer roster routes
 * (lib/actions/organizer-dashboard.ts#getDelegateList / getDelegateDetail).
 * Dates arrive as ISO strings.
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

export interface DelegatePortfolio {
  id: string;
  name: string;
}

export interface DelegatePass {
  id: string;
  name: string;
  price: number;
  currency: string;
}

export interface DelegatePayment {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
}

/** Set only when this row belongs to a group/delegation registration — see lib/actions/organizer-dashboard.ts's `registrationGroup` join. */
export interface DelegateGroupInfo {
  id: string;
  teamSize: number;
  headUser: { name: string };
}

export interface DelegateRow {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  updatedAt: string;
  user: DelegateUser;
  committee: DelegateCommittee | null;
  portfolio: DelegatePortfolio | null;
  registrationProduct: DelegatePass;
  payment: DelegatePayment[];
  registrationGroup: DelegateGroupInfo | null;
}

export interface DelegateListResult {
  results: DelegateRow[];
  total: number;
  munStatus: MunStatus;
  /** Delegates can be marked attended / no-show right now. */
  attendanceOpen: boolean;
}

export interface DelegateAnswer {
  key: string;
  label: string;
  value: string;
}

export interface DelegateProfileEssentials {
  dateOfBirth: string;
  gradeOrYear: string;
  courseOrProgram: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  requiresTransportation: boolean;
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
}

export type DelegateCheckInState = "NOT_CHECKED_IN" | "CHECKED_IN" | "NO_SHOW" | "NOT_APPLICABLE";

export interface DelegateDetail {
  registration: { id: string; status: RegistrationStatus; createdAt: string; updatedAt: string };
  delegate: {
    name: string;
    email: string;
    phone: string | null;
    institution: string | null;
    profile: DelegateProfileEssentials | null;
  };
  pass: DelegatePass;
  committee: DelegateCommittee | null;
  portfolio: DelegatePortfolio | null;
  answers: DelegateAnswer[];
  accommodation: { name: string; answers: DelegateAnswer[] } | null;
  payment: {
    status: PaymentStatus;
    amount: number;
    currency: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  checkIn: { state: DelegateCheckInState; recordedAt: string | null };
}

export type AttendanceStatus = "ATTENDED" | "NO_SHOW";

export interface AttendanceUpdate {
  registrationId: string;
  status: AttendanceStatus;
  updatedAt: string;
}
