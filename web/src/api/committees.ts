import type { Committee, CommitteeInput } from "@/types/committee";

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

export function listCommittees(munId: string) {
  return request<Committee[]>(`/muns/${munId}/committees`);
}

export function createCommittee(munId: string, input: CommitteeInput) {
  return request<Committee>(`/muns/${munId}/committees`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCommittee(committeeId: string, input: CommitteeInput) {
  return request<Committee>(`/committees/${committeeId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCommittee(committeeId: string) {
  return request<void>(`/committees/${committeeId}`, { method: "DELETE" });
}
