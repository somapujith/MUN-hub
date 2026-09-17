import type { MunStatus } from "@/types/enums";

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

/** Mirrors lib/lifecycle/registration-lifecycle.ts#LIFECYCLE_ACTIONS. */
export type LifecycleAction =
  | "open-registration"
  | "close-registration"
  | "start-conference"
  | "complete"
  | "archive"
  | "cancel";

export interface LifecycleActionResult {
  munId: string;
  status: MunStatus;
}

export interface LifecycleActionOption {
  action: LifecycleAction;
  targetStatus: MunStatus;
  /** False when a precondition currently fails — `blockedReason` says which. */
  available: boolean;
  blockedReason: string | null;
  requiresReason: boolean;
}

export interface MunLifecycleOverview {
  munId: string;
  name: string;
  status: MunStatus;
  startDate: string | null;
  endDate: string | null;
  registrationOpensAt: string | null;
  registrationDeadline: string | null;
  confirmedRegistrations: number;
  /** Next actions the signed-in user may take for the current status, in lifecycle order. */
  actions: LifecycleActionOption[];
}

export const munLifecycleQueryKey = (munId: string) => ["organizer", "lifecycle", munId] as const;

/**
 * Wraps lib/lifecycle/registration-lifecycle.ts#getLifecycleOverview —
 * owning organizer or OPERATIONS/ADMIN/SUPER_ADMIN.
 */
export function getMunLifecycle(munId: string) {
  return request<MunLifecycleOverview>(`/muns/${munId}/lifecycle`, { cache: "no-store" });
}

/**
 * Wraps lib/lifecycle/registration-lifecycle.ts#runLifecycleAction —
 * POST /muns/:munId/lifecycle/:action. open/close/start/complete: owning
 * organizer or staff; archive: staff only; cancel: owning organizer or
 * ADMIN/SUPER_ADMIN and `reason` is required. A failed precondition or a
 * status the action doesn't apply to rejects with the server's 409 message,
 * which is written to be shown as-is.
 */
export function runLifecycleAction(munId: string, action: LifecycleAction, reason?: string) {
  // A blank reason is sent as no reason, so the server's own "reason required"
  // check answers for cancel instead of a whitespace string slipping through.
  const trimmed = reason?.trim();
  return request<LifecycleActionResult>(`/muns/${munId}/lifecycle/${action}`, {
    method: "POST",
    body: JSON.stringify(trimmed ? { reason: trimmed } : {}),
  });
}
