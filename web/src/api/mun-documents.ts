import type { MunDocument, UploadMunDocumentInput } from "@/types/mun-documents";

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

export function listMunDocuments(munId: string) {
  return request<MunDocument[]>(`/muns/${munId}/documents`);
}

export function uploadMunDocument(munId: string, input: UploadMunDocumentInput) {
  return request<MunDocument>(`/muns/${munId}/documents`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteMunDocument(documentId: string) {
  return request<void>(`/documents/${documentId}`, { method: "DELETE" });
}
