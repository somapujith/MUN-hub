import type {
  ConfirmationPreview,
  GoLiveQueueParams,
  GoLiveQueueResult,
  MunGoLiveProgress,
  MunReviewFeedback,
  MunSubmissionRow,
  PublishFromQueueResult,
  SubmitMunForReviewResult,
} from "@/types/go-live";
import type { GoLiveQueueDetailResult, ReviewSubmissionInput } from "@/types/admin-muns";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    // Spread options FIRST: spreading them last replaced this merged object
    // whenever a caller passed its own headers, silently dropping Content-Type.
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Wraps lib/actions/go-live-dashboard.ts#getMunProgress — owning organizer or OPERATIONS/ADMIN/SUPER_ADMIN. */
export function getMunProgress(munId: string) {
  return request<MunGoLiveProgress>(`/muns/${munId}/progress`);
}

/** Wraps lib/actions/go-live-dashboard.ts#getMunReviewFeedback — reviewer notes and issues from Gate 1 and Gate 2. */
export function getMunReviewFeedback(munId: string) {
  return request<MunReviewFeedback>(`/muns/${munId}/review-feedback`);
}

/** Wraps lib/actions/go-live-dashboard.ts#getConfirmationPreview — the Gate-3 summary and attestation text. */
export function getConfirmationPreview(munId: string) {
  return request<ConfirmationPreview>(`/muns/${munId}/confirmation-preview`);
}

/**
 * Wraps lib/lifecycle/go-live.ts#submitMunForReview — organizer (owning) or
 * admin. Resolves with HTTP 200 either way: `passed: false` with a
 * `blockers` list is a normal result (automated validation failed), not a
 * thrown error.
 */
export function submitMunForReview(munId: string) {
  return request<SubmitMunForReviewResult>(`/muns/${munId}/actions/submit-for-review`, {
    method: "POST",
  });
}

/**
 * Wraps lib/lifecycle/go-live.ts#getGoLiveQueue — OPERATIONS/ADMIN/SUPER_ADMIN
 * only. `slaState` is computed on read server-side, never trust a cached
 * copy of this response for long.
 */
export function getGoLiveQueue(params: GoLiveQueueParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<GoLiveQueueResult>(`/admin/go-live-queue${qs ? `?${qs}` : ""}`, {
    // The server also sends Cache-Control: no-store on this route — set here
    // too so a browser-level HTTP cache never serves a stale SLA computation.
    cache: "no-store",
  });
}

/**
 * The go-live queue plus each submission's reviewer, organizer and
 * payment-account state (`GET /admin/go-live-queue/details`,
 * lib/actions/admin-muns.ts#getGoLiveQueueDetails). Staff only.
 */
export function getGoLiveQueueDetails(params: GoLiveQueueParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<GoLiveQueueDetailResult>(`/admin/go-live-queue/details${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

/**
 * Gate 2 content-review decision on the MUN's active submission — wraps
 * lib/lifecycle/go-live.ts#reviewSubmission (OPERATIONS/ADMIN/SUPER_ADMIN).
 * Legal only while the MUN is in VERIFICATION. APPROVED -> VERIFIED,
 * CHANGES_REQUESTED -> ACTION_REQUIRED, REJECTED -> REJECTED (the server
 * requires `reason` for REJECTED). Never route a Gate 1 organizer-application
 * decision through this — that is `reviewMunApplication` in
 * `@/api/admin-review`.
 */
export function reviewSubmission(munId: string, input: ReviewSubmissionInput) {
  return request<MunSubmissionRow>(`/muns/${munId}/submission/actions/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Wraps lib/lifecycle/go-live.ts#enqueueForGoLive — ADMIN/SUPER_ADMIN only.
 * Moves a VERIFIED mun into the GO_LIVE_QUEUE status so it becomes
 * publishable from this same queue.
 */
export function enqueueForGoLive(munId: string) {
  return request<MunSubmissionRow>(`/muns/${munId}/submission/actions/enqueue`, {
    method: "POST",
  });
}

/**
 * Wraps lib/lifecycle/go-live.ts#publishFromQueue — ADMIN/SUPER_ADMIN only,
 * the single most consequential write path in the system (makes a mun LIVE
 * on the public marketplace). `idempotencyKey` MUST be generated once per
 * publish attempt and reused across retries of that same attempt (never a
 * fresh key per click) — see that function's docstring for why: a retry
 * with the same key against an already-published submission returns the
 * existing result (`replay: true`) instead of erroring or re-running.
 */
export function publishFromQueue(munId: string, idempotencyKey: string) {
  return request<PublishFromQueueResult>(`/muns/${munId}/actions/publish`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
