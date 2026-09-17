import type { MunStatus } from "@/types/enums";

/**
 * Organizer-facing full mun row — shape returned by
 * `GET /organizer/muns/:munId/details` (lib/actions/mun-config.ts#getMunDetails)
 * and by the `PATCH /muns/:munId` update. Dates come back as ISO strings over
 * the wire (JSON has no Date type), mirroring the convention already used by
 * `web/src/types/mun-schedule.ts`'s `ScheduleItem`.
 */
export interface MunSetupDetails {
  id: string;
  organizerId: string;
  name: string;
  slug: string;
  edition: string | null;
  theme: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  addressLine1: string | null;
  addressState: string | null;
  postalCode: string | null;
  mapUrl: string | null;
  registrationOpensAt: string | null;
  registrationDeadline: string | null;
  accommodationProvided: "PROVIDED" | "NOT_PROVIDED" | null;
  status: MunStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Update payload — matches `updateMunDetailsBodySchema` in
 * `server/routes/mun-config.ts` exactly (`.strict()`, so no extra keys).
 */
export interface UpdateMunDetailsInput {
  name?: string;
  edition?: string | null;
  theme?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  addressLine1?: string | null;
  addressState?: string | null;
  postalCode?: string | null;
  mapUrl?: string | null;
  /** ISO date or datetime; the API coerces it to a timestamp. */
  registrationOpensAt?: string | null;
  registrationDeadline?: string | null;
}
