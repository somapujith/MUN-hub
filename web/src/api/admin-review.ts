import type {
  MunReviewDetail,
  ReviewMunApplicationInput,
  ReviewMunApplicationResult,
  ReviewQueueParams,
  ReviewQueueResult,
} from "@/types/admin-review";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Gate 1 — organizer-application review queue (`GET /admin/review-queue`,
 * wrapping `getReviewQueue`). Muns currently SUBMITTED/UNDER_REVIEW. Never
 * the Gate 2 module queue — see `getModuleReviewQueue` in
 * `@/api/module-verification`.
 */
export function getReviewQueue(params: ReviewQueueParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<ReviewQueueResult>(`/admin/review-queue${qs ? `?${qs}` : ""}`);
}

/** Full ops detail for one mun's application (`GET /admin/muns/:munId/review`), wrapping `getMunForReview`. */
export function getMunForReview(munId: string) {
  return request<MunReviewDetail>(`/admin/muns/${munId}/review`);
}

/**
 * Gate 1 decision only — approve/reject/request-changes on an organizer
 * application (`POST /admin/muns/:munId/review-application`, wrapping
 * `reviewMunApplication`). Never route a Gate 2 module decision through
 * this — use `reviewModule` in `@/api/module-verification` instead.
 */
export function reviewMunApplication(munId: string, input: ReviewMunApplicationInput) {
  return request<ReviewMunApplicationResult>(`/admin/muns/${munId}/review-application`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
