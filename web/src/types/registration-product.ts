/**
 * Organizer-facing registration product shape — the full admin row (matches
 * `lib/types/mun.ts`'s `RegistrationProduct` = InferSelectModel<registrationProducts>,
 * serialized over JSON). Distinct from the narrower public `RegistrationProduct`
 * in `@/types` used by the marketplace/registration funnel — that one is a
 * public-detail projection, this one is the organizer CRUD contract.
 */
export interface RegistrationProduct {
  id: string;
  munId: string;
  name: string;
  price: number;
  currency: string;
  capacity: number;
  deadline: string | null;
  /** Free-text status column — "active" | "inactive" in practice (soft-delete flag). */
  status: string;
  /** Set by a different, not-yet-UI-wired slice (Registration Types PRD) — read-only here. */
  registrationType: string | null;
  earlyBirdPrice: number | null;
  earlyBirdDeadline: string | null;
  description: string | null;
  allowsIndividual: boolean;
  allowsDelegation: boolean;
  displayOrder: number;
  eligibility: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * `description`/`eligibility` are deliberately NOT nullable here — the
 * server route (server/routes/mun-config.ts) mirrors lib/actions/mun-config.ts's
 * Create/UpdateRegistrationProductInput exactly, which has no "clear this
 * back to null" path for either field, only "omit to leave unchanged" or
 * "set a new value".
 */
export interface RegistrationProductInput {
  name: string;
  price: number;
  capacity: number;
  currency?: string;
  deadline?: string | null;
  description?: string;
  allowsIndividual?: boolean;
  allowsDelegation?: boolean;
  displayOrder?: number;
  eligibility?: Record<string, unknown>;
}

export interface UpdateRegistrationProductInput extends Partial<RegistrationProductInput> {
  status?: string;
}
