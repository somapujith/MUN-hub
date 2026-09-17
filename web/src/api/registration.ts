import type { MockRegistrationDetail, PaymentStatus, RegistrationStatus } from "@/types";

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

export interface InitiateRegistrationInput {
  munId: string;
  registrationProductId: string;
  committeeId?: string;
  portfolioId?: string;
  formResponses?: Record<string, unknown>;
  accommodationOptionId?: string;
  accommodationAnswers?: Record<string, unknown>;
}

export interface InitiateRegistrationResult {
  registrationId: string;
  orderId: string;
}

/**
 * Wraps `POST /registrations` (lib/actions/registration.ts#initiateRegistration).
 * Session-derived actor — never send a `userId`. Requires an
 * `Idempotency-Key` (spec Section 6.4) so a duplicate submit (double click,
 * retried network request) can't reserve two seats.
 */
export function initiateRegistration(
  input: InitiateRegistrationInput,
  idempotencyKey: string,
): Promise<InitiateRegistrationResult> {
  return request<InitiateRegistrationResult>("/registrations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

/**
 * Wire shape of `GET /registrations/:id` (server/routes/registrations.ts).
 * Dates come back as ISO strings (JSON has no Date type) — converted below,
 * same convention as `api/student-dashboard.ts#RawRegistration`.
 */
interface RawRegistrationDetail {
  id: string;
  status: RegistrationStatus;
  registrationProductId: string;
  committeeId: string | null;
  portfolioId: string | null;
  userId: string;
  expiresAt: string | null;
  productName: string;
  productPrice: number;
  mun: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  committee: { name: string } | null;
  portfolio: { name: string } | null;
  payment: Array<{ amount: number; status: PaymentStatus }>;
}

function toRegistrationDetail(raw: RawRegistrationDetail): MockRegistrationDetail {
  return {
    id: raw.id,
    status: raw.status,
    registrationProductId: raw.registrationProductId,
    committeeId: raw.committeeId,
    portfolioId: raw.portfolioId,
    userId: raw.userId,
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null,
    productName: raw.productName,
    productPrice: raw.productPrice,
    mun: {
      id: raw.mun.id,
      slug: raw.mun.slug,
      name: raw.mun.name,
      city: raw.mun.city,
      country: raw.mun.country,
      startDate: raw.mun.startDate ? new Date(raw.mun.startDate) : null,
      endDate: raw.mun.endDate ? new Date(raw.mun.endDate) : null,
    },
    committee: raw.committee ? { name: raw.committee.name } : null,
    portfolio: raw.portfolio ? { name: raw.portfolio.name } : null,
    payment: raw.payment.map((p) => ({ amount: p.amount, status: p.status })),
  };
}

/**
 * Wraps `GET /registrations/:id`. Throws (via `request`) on a 404 or a 403
 * — the caller isn't the owner/admin/organizer for this registration.
 */
export async function fetchRegistrationById(id: string): Promise<MockRegistrationDetail> {
  const raw = await request<RawRegistrationDetail>(`/registrations/${id}`);
  return toRegistrationDetail(raw);
}

export interface MockPaymentResult {
  ok: boolean;
  alreadyConfirmed?: boolean;
  refundOwed?: boolean;
}

/**
 * Wraps `POST /registrations/:id/mock-payment` — the mock checkout submit.
 * Signs a provider-shaped payload server-side and posts it to the real
 * `/webhooks/payments` route, so confirmation still only ever happens there
 * (never client-driven). See server/routes/registrations.ts for the full
 * rationale, ported from `app/register/[slug]/actions.ts#completeMockPaymentAction`.
 */
export function completeMockPayment(
  registrationId: string,
  outcome: "success" | "failure",
): Promise<MockPaymentResult> {
  return request<MockPaymentResult>(`/registrations/${registrationId}/mock-payment`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}
