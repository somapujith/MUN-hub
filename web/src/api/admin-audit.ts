import type {
  AdminAuditActor,
  AdminAuditEntry,
  AdminAuditListResult,
  AdminOverviewStats,
  AuditHistoryEntry,
} from "@/types/admin-audit";

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

export function getAdminOverviewStats() {
  return request<AdminOverviewStats>("/admin/overview");
}

export interface AdminAuditListParams {
  limit?: number;
  offset?: number;
  /** Include staff reads of delegate data (PII_READ rows); the server leaves them out by default. */
  includeDataAccess?: boolean;
  /** Exact actor match — a real user id, from `listAuditActors`. */
  actorId?: string;
  /** Exact match against the feed's action label (an admin_action value or an APPLICATION_* Gate 1 label). */
  actionType?: string;
  /** Inclusive lower bound on when the entry happened. */
  from?: Date;
  /** Inclusive upper bound on when the entry happened — pass end-of-day to include the whole day. */
  to?: Date;
}

interface RawAdminAuditEntry extends Omit<AdminAuditEntry, "createdAt"> {
  createdAt: string;
}

interface RawAdminAuditListResult {
  results: RawAdminAuditEntry[];
  total: number;
}

export async function listAdminAuditEntries(
  params: AdminAuditListParams = {},
): Promise<AdminAuditListResult> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.includeDataAccess) query.set("includeDataAccess", "true");
  if (params.actorId) query.set("actorId", params.actorId);
  if (params.actionType) query.set("actionType", params.actionType);
  if (params.from) query.set("from", params.from.toISOString());
  if (params.to) query.set("to", params.to.toISOString());
  const qs = query.toString();

  const raw = await request<RawAdminAuditListResult>(`/admin/audit${qs ? `?${qs}` : ""}`);
  return {
    total: raw.total,
    results: raw.results.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) })),
  };
}

interface RawAuditHistoryEntry extends Omit<AuditHistoryEntry, "createdAt"> {
  createdAt: string;
}

export async function getAuditHistory(
  targetType: string,
  targetId: string,
): Promise<AuditHistoryEntry[]> {
  const raw = await request<RawAuditHistoryEntry[]>(
    `/admin/audit/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
  );
  return raw.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) }));
}

/** Options for the audit page's actor filter — every id returned already appears in the feed. */
export function listAuditActors(): Promise<AdminAuditActor[]> {
  return request<AdminAuditActor[]>("/admin/audit/actors");
}
