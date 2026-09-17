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
  return response.json() as Promise<T>;
}

/** Mirrors lib/actions/organizer-ops-errors.ts#COMMUNICATION_LIMITS (the server enforces them). */
export const COMMUNICATION_LIMITS = {
  subjectMaxLength: 150,
  bodyMaxLength: 5000,
} as const;

export type MessageableStatus = "CONFIRMED" | "ATTENDED" | "NO_SHOW";

export interface CommunicationAudience {
  statuses?: MessageableStatus[];
  registrationProductId?: string;
  committeeId?: string;
}

export interface AudiencePreview {
  recipientCount: number;
  maxRecipientsPerSend: number;
  sendsRemainingThisHour: number;
}

export interface SendCommunicationResult {
  recipientCount: number;
  sent: number;
  failed: number;
}

export interface CommunicationHistoryEntry {
  id: string;
  sentAt: string;
  sentBy: string;
  subject: string;
  recipientCount: number;
}

export const communicationKeys = {
  all: (munId: string) => ["organizer", "communications", munId] as const,
  history: (munId: string) => ["organizer", "communications", munId, "history"] as const,
  audience: (munId: string, audience: CommunicationAudience) =>
    ["organizer", "communications", munId, "audience", audience] as const,
};

export function previewAudience(munId: string, audience: CommunicationAudience) {
  const params = new URLSearchParams();
  if (audience.statuses?.length) params.set("status", audience.statuses.join(","));
  if (audience.registrationProductId) params.set("registrationProductId", audience.registrationProductId);
  if (audience.committeeId) params.set("committeeId", audience.committeeId);
  const qs = params.toString();
  return request<AudiencePreview>(`/organizer/muns/${munId}/communications/audience${qs ? `?${qs}` : ""}`);
}

export function sendCommunication(
  munId: string,
  input: { subject: string; body: string; audience: CommunicationAudience },
) {
  return request<SendCommunicationResult>(`/organizer/muns/${munId}/communications`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listCommunications(munId: string) {
  return request<CommunicationHistoryEntry[]>(`/organizer/muns/${munId}/communications`);
}
