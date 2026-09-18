import type { PaymentStatus, RegistrationStatus } from "@/types/enums";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => undefined)) as T;
}

export const GROUP_MIN_SIZE = 2;
export const GROUP_MAX_SIZE = 20;

export interface StartGroupRegistrationInput {
  munId: string;
  registrationProductId: string;
  teamSize: number;
  formResponses?: Record<string, unknown>;
}

export interface StartGroupRegistrationResult {
  groupId: string;
  headRegistrationId: string;
  orderId: string | null;
  status: RegistrationStatus;
  replayed: boolean;
}

/** Wraps `POST /registrations/group` (lib/actions/registration.ts#initiateGroupRegistration). */
export function initiateGroupRegistration(
  input: StartGroupRegistrationInput,
  idempotencyKey: string,
): Promise<StartGroupRegistrationResult> {
  return request<StartGroupRegistrationResult>("/registrations/group", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export type GroupInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

export interface GroupRosterSlot {
  registrationId: string;
  isHead: boolean;
  member: { name: string; email: string } | null;
  registrationStatus: RegistrationStatus;
  invitation: {
    id: string;
    email: string;
    invitedName: string | null;
    status: GroupInvitationStatus;
    expiresAt: string;
  } | null;
}

export interface GroupRoster {
  id: string;
  munId: string;
  munName: string;
  munSlug: string;
  productName: string;
  teamSize: number;
  headUserId: string;
  headRegistrationId: string;
  status: RegistrationStatus;
  payment: { amount: number; currency: string; status: PaymentStatus } | null;
  slots: GroupRosterSlot[];
}

/** Wraps `GET /registration-groups/:id` — head delegate's (or staff's) roster view. */
export function fetchGroupRoster(groupId: string): Promise<GroupRoster> {
  return request<GroupRoster>(`/registration-groups/${encodeURIComponent(groupId)}`);
}

export interface GroupInvitationSummary {
  id: string;
  email: string;
  invitedName: string | null;
  expiresAt: string;
}

/** Wraps `POST /registration-groups/:id/invitations`. */
export function inviteGroupMember(
  groupId: string,
  input: { email: string; invitedName?: string },
): Promise<GroupInvitationSummary> {
  return request<GroupInvitationSummary>(`/registration-groups/${encodeURIComponent(groupId)}/invitations`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Wraps `POST /registration-groups/invitations/:invitationId/resend`. */
export function resendGroupInvitation(invitationId: string): Promise<GroupInvitationSummary> {
  return request<GroupInvitationSummary>(
    `/registration-groups/invitations/${encodeURIComponent(invitationId)}/resend`,
    { method: "POST" },
  );
}

/** Wraps `POST /registration-groups/invitations/:invitationId/cancel`. */
export function cancelGroupInvitation(invitationId: string): Promise<void> {
  return request<void>(`/registration-groups/invitations/${encodeURIComponent(invitationId)}/cancel`, {
    method: "POST",
  });
}

/**
 * Wraps `POST /registration-groups/:id/registrations/:registrationId/release`
 * — hands an accepted teammate's seat back to the head so it can be invited
 * to again. Only legal while the team hasn't paid yet; the API answers 409
 * once it has, so callers should gate offering this in the UI on the
 * roster's own paid/unpaid status rather than relying on the error alone.
 */
export function releaseGroupSeat(groupId: string, registrationId: string): Promise<void> {
  return request<void>(
    `/registration-groups/${encodeURIComponent(groupId)}/registrations/${encodeURIComponent(registrationId)}/release`,
    { method: "POST" },
  );
}

export interface GroupInvitationPreview {
  status: GroupInvitationStatus;
  munName: string;
  munSlug: string;
  productName: string;
  headName: string;
  invitedEmail: string;
}

/** Wraps `GET /group-invitations/:token` — public, no auth required. */
export function fetchInvitationPreview(token: string): Promise<GroupInvitationPreview> {
  return request<GroupInvitationPreview>(`/group-invitations/${encodeURIComponent(token)}`);
}

export interface AcceptedGroupInvitation {
  registrationId: string;
  munSlug: string;
}

/** Wraps `POST /group-invitations/:token/accept`. Requires the caller to be signed in. */
export function acceptGroupInvitation(
  token: string,
  formResponses?: Record<string, unknown>,
): Promise<AcceptedGroupInvitation> {
  return request<AcceptedGroupInvitation>(`/group-invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: JSON.stringify({ formResponses }),
  });
}
