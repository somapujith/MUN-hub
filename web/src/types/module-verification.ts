import type { ModuleVerificationState, MunModule, VerificationSeverity } from "@/types/enums";

/**
 * Gate 2 — MUN-content review ("is this MUN's content correct enough to
 * publish"), at module granularity. Operates on `mun_module_verifications`
 * rows via `reviewModule` (lib/lifecycle/module-verification.ts). Never
 * confuse with Gate 1 (organizer-application review) — see
 * web/src/types/admin-review.ts and CLAUDE.md's "Gate-1 vs Gate-2
 * vocabulary" section.
 */
export type ModuleReviewDecision = "VERIFIED" | "CHANGES_REQUESTED" | "REJECTED";

/** One row of `getModuleReviewQueue` — a module a reviewer needs to act on. */
export interface ModuleReviewQueueRow {
  id: string;
  munId: string;
  munName: string;
  moduleName: MunModule;
  state: ModuleVerificationState;
  organizerConfirmedAt: string | null;
}

export interface ModuleReviewQueueResult {
  results: ModuleReviewQueueRow[];
  total: number;
}

export interface ModuleReviewQueueParams {
  /** Default 'PENDING_REVIEW' (pending). */
  status?: ModuleVerificationState;
  /** Matches the MUN name. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface VerificationIssueInput {
  severity: VerificationSeverity;
  reason: string;
  previousValue?: string;
  newValue?: string;
}

export interface ReviewModuleInput {
  decision: ModuleReviewDecision;
  issues: VerificationIssueInput[];
}

/** `reviewModule`'s return value — the module's post-decision row. */
export interface ModuleVerificationRow {
  id: string;
  munId: string;
  moduleName: MunModule;
  state: ModuleVerificationState;
  organizerConfirmedAt: string | null;
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  isRequired: boolean;
}
