import type { MunStatus, Role } from "@/types/enums";

export type {
  MunStatus,
  Role,
  RegistrationStatus,
  PaymentStatus,
} from "@/types/enums";

/** Card-shaped summary for marketplace listing/search results. */
export interface MunSummary {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: MunStatus;
  minPrice: number | null;
  coverImage: string | null;
  organizerName: string | null;
}

export interface Portfolio {
  id: string;
  committeeId: string;
  name: string;
  country: string | null;
  capacity: number;
  /** Remaining seats for this portfolio (schema: integer, default 1). */
  availability: number;
}

export interface Committee {
  id: string;
  munId: string;
  name: string;
  abbreviation: string | null;
  description: string | null;
  capacity: number;
  agenda?: string | null;
}

export interface CommitteeWithPortfolios extends Committee {
  portfolios: Portfolio[];
}

export interface RegistrationProduct {
  id: string;
  munId: string;
  name: string;
  description: string | null;
  price: number;
  capacity: number;
  deadline: Date | null;
  isActive: boolean;
}

/** Full public detail shape — mirrors fields used by ported UI. */
export interface MunDetail {
  id: string;
  organizerId: string;
  name: string;
  slug: string;
  edition: string | null;
  theme: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  status: MunStatus;
  committees: CommitteeWithPortfolios[];
  registrationProducts: RegistrationProduct[];
  organizerName: string | null;
}

export interface Session {
  userId: string;
  role: Role;
}

export interface MunSearchResult {
  results: MunSummary[];
  total: number;
}

/** Shape consumed by dashboard registration cards (mirrors lib/actions/student-dashboard). */
export interface RegistrationWithMun {
  id: string;
  status: import("@/types/enums").RegistrationStatus;
  registrationProductId: string;
  committeeId: string | null;
  portfolioId: string | null;
  userId: string;
  expiresAt: Date | null;
  mun: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    startDate: Date | null;
    endDate: Date | null;
  };
  committee: { name: string } | null;
  portfolio: { name: string } | null;
  payment: Array<{ amount: number; status: import("@/types/enums").PaymentStatus }>;
}

export interface MockRegistrationDetail extends RegistrationWithMun {
  productName: string;
  productPrice: number;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string | null;
  institution: string | null;
}

export type SupportCategory =
  | "REGISTRATION"
  | "PAYMENT"
  | "REFUND"
  | "MUN_INFO"
  | "ACCOUNT"
  | "CERTIFICATE"
  | "ORGANIZER"
  | "TECHNICAL"
  | "SAFETY_POLICY";
