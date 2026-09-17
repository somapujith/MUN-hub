import type { MunMediaItem, UploadMunMediaInput } from "@/types/mun-branding";

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

/** Wraps lib/actions/mun-branding.ts#listMunMedia. Unpublished MUNs: owner and staff only. */
export function listMunMedia(munId: string) {
  return request<MunMediaItem[]>(`/muns/${munId}/media`);
}

/** Wraps lib/actions/mun-branding.ts#uploadMunMedia. A new LOGO or COVER replaces the old one. */
export function uploadMunMedia(munId: string, input: UploadMunMediaInput) {
  return request<MunMediaItem>(`/muns/${munId}/media`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteMunMedia(mediaId: string) {
  return request<void>(`/media/${mediaId}`, { method: "DELETE" });
}
