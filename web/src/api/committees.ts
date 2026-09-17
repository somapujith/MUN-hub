import type { Committee, CommitteeInput, Portfolio, PortfolioInput } from "@/types/committee";

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

export function listCommittees(munId: string) {
  return request<Committee[]>(`/muns/${munId}/committees`);
}

export function createCommittee(munId: string, input: CommitteeInput) {
  return request<Committee>(`/muns/${munId}/committees`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCommittee(committeeId: string, input: CommitteeInput) {
  return request<Committee>(`/committees/${committeeId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCommittee(committeeId: string) {
  return request<void>(`/committees/${committeeId}`, { method: "DELETE" });
}

export function listPortfolios(committeeId: string) {
  return request<Portfolio[]>(`/committees/${committeeId}/portfolios`);
}

export function createPortfolio(committeeId: string, input: PortfolioInput) {
  return request<Portfolio>(`/committees/${committeeId}/portfolios`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Adds a whole list at once; the API rejects all of it if any name is taken. */
export function createPortfolios(committeeId: string, portfolios: PortfolioInput[]) {
  return request<Portfolio[]>(`/committees/${committeeId}/portfolios/bulk`, {
    method: "POST",
    body: JSON.stringify({ portfolios }),
  });
}

export function updatePortfolio(portfolioId: string, input: Partial<PortfolioInput>) {
  return request<Portfolio>(`/portfolios/${portfolioId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePortfolio(portfolioId: string) {
  return request<void>(`/portfolios/${portfolioId}`, { method: "DELETE" });
}
