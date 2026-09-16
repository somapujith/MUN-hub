import type { MunModule, VerificationSeverity } from "@/types/enums";

/**
 * Display labels for the 19 `MunModule` keys. Frontend-local mirror of
 * `lib/lifecycle/module-registry.ts`'s `MODULE_REGISTRY` labels — the web
 * app talks to `/server` over HTTP only and has no import access to the
 * repo-root `/lib`, so this is a deliberate duplication, same pattern as
 * `web/src/types/enums.ts` mirroring `lib/db/schema-enums.ts`.
 */
export const MODULE_LABELS: Record<MunModule, string> = {
  // legacy pre-PRD keys, retained only because old rows can still reference them
  mun_details: "MUN Details (legacy)",
  committees: "Committees (legacy)",
  portfolios: "Portfolios (legacy)",
  registration_products: "Registration Products (legacy)",
  // PRD Section 38 module keys
  BASIC_INFO: "Basic Info",
  DATES_VENUE: "Dates & Venue",
  BRANDING: "Branding",
  COMMITTEES: "Committees",
  PORTFOLIOS: "Portfolios",
  EXECUTIVE_BOARD: "Executive Board",
  REGISTRATION_TYPES: "Registration Types",
  REGISTRATION_FORM: "Registration Form",
  PRICING_CAPACITY: "Pricing & Capacity",
  PAYMENT_SETTLEMENT: "Payment Settlement",
  RULES_DOCUMENTS: "Rules & Documents",
  SCHEDULE: "Schedule",
  ACCOMMODATION: "Accommodation",
  CONTACT: "Contact",
  FINAL_REVIEW: "Final Review",
};

export const SEVERITY_LABELS: Record<VerificationSeverity, string> = {
  BLOCKER: "Blocker",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const SEVERITY_OPTIONS: VerificationSeverity[] = ["BLOCKER", "HIGH", "MEDIUM", "LOW"];
