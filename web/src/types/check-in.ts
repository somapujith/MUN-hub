import type { RegistrationStatus } from "@/types/enums";

/**
 * Shapes returned by the check-in routes (server/routes/check-in.ts, wrapping
 * lib/actions/check-in.ts). Dates arrive as ISO strings.
 */
export interface RegistrationPass {
  registrationId: string;
  status: RegistrationStatus;
  checkedIn: boolean;
  delegateName: string;
  mun: {
    name: string;
    slug: string;
    startDate: string | null;
    endDate: string | null;
    venue: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  };
  passName: string;
  committee: string | null;
  portfolio: string | null;
  /** `XXXXX-XXXXX` */
  checkInCode: string;
}

export interface CheckedInDelegate {
  registrationId: string;
  name: string;
  institution: string | null;
  passName: string;
  committee: string | null;
  portfolio: string | null;
}

export interface CheckInResult {
  outcome: "CHECKED_IN" | "ALREADY_CHECKED_IN";
  checkedInAt: string;
  delegate: CheckedInDelegate;
}
