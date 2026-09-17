import type { PaymentStatus, RegistrationStatus, RegistrationWithMun } from "@/types";

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

/**
 * Wire shape of a row from GET /me/registrations/{upcoming,past}
 * (server/routes/student-dashboard.ts, wrapping
 * lib/actions/student-dashboard.ts#getUpcomingRegistrations/getPastRegistrations).
 * Dates come back as ISO strings (JSON has no Date type), and the Drizzle
 * relation rows (mun/committee/portfolio/payment) carry more columns than
 * the dashboard needs — only the fields below are read.
 */
interface RawRegistration {
  id: string;
  status: RegistrationStatus;
  registrationProductId: string;
  committeeId: string | null;
  portfolioId: string | null;
  userId: string;
  expiresAt: string | null;
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

function toRegistrationWithMun(raw: RawRegistration): RegistrationWithMun {
  return {
    id: raw.id,
    status: raw.status,
    registrationProductId: raw.registrationProductId,
    committeeId: raw.committeeId,
    portfolioId: raw.portfolioId,
    userId: raw.userId,
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null,
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

export async function fetchUpcomingRegistrations(): Promise<RegistrationWithMun[]> {
  const rows = await request<RawRegistration[]>("/me/registrations/upcoming");
  return rows.map(toRegistrationWithMun);
}

export async function fetchPastRegistrations(): Promise<RegistrationWithMun[]> {
  const rows = await request<RawRegistration[]>("/me/registrations/past");
  return rows.map(toRegistrationWithMun);
}
