import type { AchievementRow, CreateAchievementInput } from "@/types/results";

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

/** Wraps lib/actions/results.ts#listMunAchievements — session-gated, ownership re-checked server-side. */
export function listMunAchievements(munId: string) {
  return request<AchievementRow[]>(`/organizer/muns/${munId}/achievements`);
}

export function createAchievement(munId: string, input: CreateAchievementInput) {
  return request<AchievementRow>(`/organizer/muns/${munId}/achievements`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteAchievement(id: string) {
  return request<void>(`/achievements/${id}`, { method: "DELETE" });
}
