import type {
  ExecutiveBoardCommittee,
  ExecutiveBoardMember,
  ExecutiveBoardMemberInput,
} from "@/types/executive-board";

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

export function listExecutiveBoardMembers(munId: string) {
  return request<ExecutiveBoardMember[]>(`/muns/${munId}/executive-board/manage`);
}

export function listCommitteesForExecutiveBoard(munId: string) {
  return request<ExecutiveBoardCommittee[]>(`/muns/${munId}/committees`);
}

export function createExecutiveBoardMember(munId: string, input: ExecutiveBoardMemberInput) {
  return request<ExecutiveBoardMember>(`/muns/${munId}/executive-board`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateExecutiveBoardMember(memberId: string, input: ExecutiveBoardMemberInput) {
  return request<ExecutiveBoardMember>(`/executive-board/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteExecutiveBoardMember(memberId: string) {
  return request<void>(`/executive-board/${memberId}`, { method: "DELETE" });
}