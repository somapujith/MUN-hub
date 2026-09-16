import type {
  AdminRegistrationRow,
  AdminRegistrationsQueueResult,
} from "@/types/admin-registrations";

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

export interface AdminRegistrationsQueueParams {
  q?: string;
  limit?: number;
  offset?: number;
}

interface RawAdminRegistrationRow extends Omit<AdminRegistrationRow, "createdAt"> {
  createdAt: string;
}

interface RawAdminRegistrationsQueueResult {
  results: RawAdminRegistrationRow[];
  total: number;
}

/**
 * Platform-wide, paginated registrations browse with optional `?q=` search —
 * wraps `/admin/registrations` (server/routes/admin.ts, backed by
 * `lib/actions/admin-review.ts#getRegistrationsQueue`). Distinct from the
 * `/admin/search/registrations` endpoint, which requires a non-empty query
 * and has no pagination.
 */
export async function getRegistrationsQueue(
  params: AdminRegistrationsQueueParams = {},
): Promise<AdminRegistrationsQueueResult> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();

  const raw = await request<RawAdminRegistrationsQueueResult>(
    `/admin/registrations${qs ? `?${qs}` : ""}`,
  );
  return {
    total: raw.total,
    results: raw.results.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
  };
}
