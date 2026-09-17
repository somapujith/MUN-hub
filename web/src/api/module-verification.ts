import type { MunModule } from "@/types/enums";
import type {
  ModuleReviewQueueParams,
  ModuleReviewQueueResult,
  ModuleVerificationRow,
  ReviewModuleInput,
} from "@/types/module-verification";

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

/**
 * Gate 2 — module-level content-verification queue (`GET
 * /admin/module-review-queue`, wrapping `getModuleReviewQueue`). All
 * PENDING_REVIEW `mun_module_verifications` rows across every mun. Never the
 * Gate 1 application queue — see `getReviewQueue` in `@/api/admin-review`.
 */
export function getModuleReviewQueue(params: ModuleReviewQueueParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<ModuleReviewQueueResult>(`/admin/module-review-queue${qs ? `?${qs}` : ""}`);
}

/**
 * Organizer's per-module "send for review" (`POST
 * /muns/:munId/modules/:moduleName/actions/confirm`, wrapping `confirmModule`).
 * Legal only from NOT_SUBMITTED or CHANGES_REQUESTED.
 */
export function confirmModule(munId: string, moduleName: MunModule) {
  return request<ModuleVerificationRow>(`/muns/${munId}/modules/${moduleName}/actions/confirm`, {
    method: "POST",
  });
}

/**
 * Marks one module required or optional for this MUN (`PATCH
 * /muns/:munId/modules/:moduleName/requirement`, wrapping
 * `setModuleRequirement`). ADMIN/SUPER_ADMIN only; FINAL_REVIEW can't be made
 * optional.
 */
export function setModuleRequirement(munId: string, moduleName: MunModule, isRequired: boolean) {
  return request<ModuleVerificationRow>(`/muns/${munId}/modules/${moduleName}/requirement`, {
    method: "PATCH",
    body: JSON.stringify({ isRequired }),
  });
}

/**
 * Gate 2 reviewer decision on one module (`POST
 * /muns/:munId/modules/:moduleName/actions/review`, wrapping `reviewModule`).
 * Never route a Gate 1 application decision through this — use
 * `reviewMunApplication` in `@/api/admin-review` instead.
 */
export function reviewModule(munId: string, moduleName: MunModule, input: ReviewModuleInput) {
  return request<ModuleVerificationRow>(`/muns/${munId}/modules/${moduleName}/actions/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
