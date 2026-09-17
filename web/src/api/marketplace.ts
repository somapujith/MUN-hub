import type { MunDetail, MunSearchResult, MunSummary, RegistrationProduct } from "@/types";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Thrown by `request()` — carries the HTTP status so callers can branch on it
 * (e.g. `getMunBySlug` treats a 404 as "not found" rather than a transient
 * failure), matching the shape `web/src/api/query-client.ts`'s retry logic
 * already expects (`error instanceof Error && "status" in error`).
 */
export class MarketplaceApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MarketplaceApiError";
    this.status = status;
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new MarketplaceApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** Raw JSON shape of a marketplace summary row — dates travel as ISO strings over the wire. */
interface RawMunSummary extends Omit<MunSummary, "startDate" | "endDate"> {
  startDate: string | null;
  endDate: string | null;
}

interface RawMunSearchResult {
  results: RawMunSummary[];
  total: number;
}

function normalizeMunSummary(raw: RawMunSummary): MunSummary {
  return { ...raw, startDate: toDate(raw.startDate), endDate: toDate(raw.endDate) };
}

export type MunSearchParams = {
  query?: string;
  city?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: "date" | "price" | "newest";
  status?: string[];
  limit?: number;
  offset?: number;
}

function buildSearchQuery(params: MunSearchParams): string {
  const qs = new URLSearchParams();
  if (params.query) qs.set("query", params.query);
  if (params.city) qs.set("city", params.city);
  if (params.country) qs.set("country", params.country);
  if (params.minPrice !== undefined) qs.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined) qs.set("maxPrice", String(params.maxPrice));
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.status && params.status.length > 0) qs.set("status", params.status.join(","));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Public marketplace search — `GET /muns`, wrapping
 * `lib/actions/marketplace#searchMuns`. Omitting `status` lets the server
 * apply its own public-status default (PUBLISHED/REGISTRATION_OPEN/
 * REGISTRATION_CLOSED); pass it explicitly to narrow to one lifecycle bucket
 * (e.g. the homepage's "open now" / "opening soon" / "closed" shelves).
 */
export async function searchMuns(params: MunSearchParams = {}): Promise<MunSearchResult> {
  const raw = await request<RawMunSearchResult>(`/muns${buildSearchQuery(params)}`);
  return { results: raw.results.map(normalizeMunSummary), total: raw.total };
}

/** Distinct city/country values across publicly-visible MUNs, for filter dropdowns. */
export function getMarketplaceFacets(): Promise<{ cities: string[]; countries: string[] }> {
  return request<{ cities: string[]; countries: string[] }>("/muns/facets");
}

/**
 * `registration_products.status` ('active' | 'inactive') travels over the
 * wire in place of the web layer's `isActive` boolean — `getMunBySlug` only
 * ever returns active products anyway, but the mapping is kept honest rather
 * than hardcoding `true`.
 */
interface RawRegistrationProduct extends Omit<RegistrationProduct, "deadline" | "earlyBirdDeadline"> {
  deadline: string | null;
  earlyBirdDeadline?: string | null;
  status?: string;
}

interface RawMunDetail extends Omit<MunDetail, "startDate" | "endDate" | "registrationProducts"> {
  startDate: string | null;
  endDate: string | null;
  registrationProducts: RawRegistrationProduct[];
}

function normalizeMunDetail(raw: RawMunDetail): MunDetail {
  return {
    ...raw,
    startDate: toDate(raw.startDate),
    endDate: toDate(raw.endDate),
    registrationProducts: raw.registrationProducts.map((product) => ({
      ...product,
      deadline: toDate(product.deadline),
      earlyBirdDeadline: toDate(product.earlyBirdDeadline),
      isActive: product.status ? product.status === "active" : true,
    })),
  };
}

/**
 * Full public MUN detail by slug — `GET /muns/:slug`, wrapping
 * `getMunBySlug`. Resolves to `null` (not a thrown error) both when the slug
 * doesn't exist and when the mun exists but isn't in a publicly-visible
 * lifecycle state yet, matching the server action's own null-on-either
 * contract; the route surfaces both as a 404, which is unwrapped here.
 */
export async function getMunBySlug(slug: string): Promise<MunDetail | null> {
  try {
    const raw = await request<RawMunDetail>(`/muns/${encodeURIComponent(slug)}`);
    return normalizeMunDetail(raw);
  } catch (error) {
    if (error instanceof MarketplaceApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export interface ProductAvailability {
  capacity: number;
  taken: number;
  available: number;
}

/**
 * Live seat counts for a batch of registration products — `GET
 * /products/availability`, wrapping `getProductsAvailability`. Public (no
 * auth), same as the mun detail page itself. Returns `{}` for an empty
 * input without a network call, since the endpoint requires at least one id.
 */
export async function getProductsAvailability(
  productIds: string[],
): Promise<Record<string, ProductAvailability>> {
  if (productIds.length === 0) return {};
  const { availability } = await request<{ availability: Record<string, ProductAvailability> }>(
    `/products/availability?ids=${encodeURIComponent(productIds.join(","))}`,
  );
  return availability;
}
