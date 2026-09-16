import type { MunStatus } from "@/types/enums";

/**
 * Gate 1 — organizer-APPLICATION review ("is this organization allowed to
 * run a MUN on our platform"). Operates on `muns.status` SUBMITTED/
 * UNDER_REVIEW rows via `reviewMunApplication` (lib/actions/admin-review.ts).
 * Never confuse with Gate 2 (module-content review) — see
 * web/src/types/module-verification.ts and CLAUDE.md's "Gate-1 vs Gate-2
 * vocabulary" section.
 */
export type ReviewDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

/** One row of `getReviewQueue` — a mun awaiting an organizer-application decision. */
export interface ReviewQueueRow {
  id: string;
  name: string;
  slug: string;
  status: MunStatus;
  city: string | null;
  country: string | null;
  createdAt: string;
}

export interface ReviewQueueResult {
  results: ReviewQueueRow[];
  total: number;
}

export interface ReviewQueueParams {
  limit?: number;
  offset?: number;
}

export interface OrganizerApplicationSummary {
  status: string;
  reviewNotes: string | null;
  submittedAt: string;
}

export interface VerificationLogEntry {
  id: string;
  action: string;
  notes: string | null;
  internalNotes: string | null;
  reviewerId: string;
  createdAt: string;
}

/**
 * Ops-only detail returned by `getMunForReview` — includes `internalNotes`
 * on each log entry, so this shape must never be surfaced on a non-admin/ops
 * page.
 */
export interface MunReviewDetail {
  id: string;
  name: string;
  slug: string;
  status: MunStatus;
  city: string | null;
  country: string | null;
  createdAt: string;
  organizerApplication: OrganizerApplicationSummary | null;
  verificationLogs: VerificationLogEntry[];
}

export interface ReviewMunApplicationInput {
  decision: ReviewDecision;
  notes?: string;
  internalNotes?: string;
}

export interface ReviewMunApplicationResult {
  id: string;
  status: MunStatus;
}
