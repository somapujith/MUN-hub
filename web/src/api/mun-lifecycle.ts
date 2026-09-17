import type { MunLifecycleAction, MunLifecycleResult } from "@/types/admin-muns";

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
 * Moves a MUN through its post-publish lifecycle:
 * `POST /muns/:munId/lifecycle/:action` with `{ reason? }`, answering
 * `{ munId, status }`. `cancel` requires a reason. The server decides which
 * transitions are legal from the current status and who may run them.
 */
export function runLifecycleAction(munId: string, action: MunLifecycleAction, reason?: string) {
  const trimmed = reason?.trim();
  return request<MunLifecycleResult>(`/muns/${munId}/lifecycle/${action}`, {
    method: "POST",
    body: JSON.stringify(trimmed ? { reason: trimmed } : {}),
  });
}
