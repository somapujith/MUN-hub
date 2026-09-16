import type {
  ScheduleCommittee,
  ScheduleItem,
  ScheduleItemInput,
} from "@/types/mun-schedule";

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

/** Public read — the mun detail page also renders this. Reused here for the committee-assignment dropdown. */
export function listCommitteesForSchedule(munId: string) {
  return request<ScheduleCommittee[]>(`/muns/${munId}/committees`);
}

export function listScheduleItems(munId: string) {
  return request<ScheduleItem[]>(`/muns/${munId}/schedule`);
}

export function createScheduleItem(munId: string, input: ScheduleItemInput) {
  return request<ScheduleItem>(`/muns/${munId}/schedule`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateScheduleItem(itemId: string, input: ScheduleItemInput) {
  return request<ScheduleItem>(`/schedule/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteScheduleItem(itemId: string) {
  return request<void>(`/schedule/${itemId}`, { method: "DELETE" });
}
