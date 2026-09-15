import type { MunStatus } from "@/types/enums";

/**
 * Shared vocabulary for the homepage filter rail.
 *
 * Deliberately a plain module, NOT part of `home-filter-sidebar.tsx`: that file
 * is `"use client"`, and a server component importing a value across that
 * boundary gets a client-reference proxy rather than the array
 * (`PUBLIC_STATUS_VALUES.includes is not a function` — this exact bug, caught at
 * runtime). Both the rail and `app/page.tsx` import from here so the options the
 * rail renders and the bounds the server queries can never drift apart.
 *
 * This is UI vocabulary, not a backend contract — it maps onto the existing
 * `MunSearchParams` (`status`, `minPrice`, `maxPrice`) and adds nothing to
 * `lib/actions/marketplace.ts`.
 */

/**
 * Public, offerable statuses, ordered by the delegate's funnel rather than the
 * enum's declaration order.
 *
 * Only the three statuses in `searchMuns`' `DEFAULT_PUBLIC_STATUSES` are
 * offerable; the other twelve are internal/pre-publication states that
 * `searchMuns` refuses to surface to anonymous visitors, so listing them would
 * be a filter guaranteed to return nothing.
 */
export const STATUS_OPTIONS = [
  { value: "REGISTRATION_OPEN", label: "Registration open" },
  { value: "PUBLISHED", label: "Not yet open" },
  { value: "REGISTRATION_CLOSED", label: "Registration closed" },
] as const satisfies readonly { value: MunStatus; label: string }[];

export type PublicStatusValue = (typeof STATUS_OPTIONS)[number]["value"];

/** The status values the rail is allowed to emit into `?status=`. */
export const PUBLIC_STATUS_VALUES: readonly PublicStatusValue[] =
  STATUS_OPTIONS.map((option) => option.value);

/**
 * Price bands, in INR, as `[min, max]` bounds passed straight through to
 * `searchMuns`' `minPrice`/`maxPrice` (which filter on the cheapest active
 * registration product). `undefined` means unbounded on that side.
 *
 * Boundaries are chosen against real seeded fee data (₹1,000–₹2,500 across the
 * demo MUNs) so every band can actually return rows — a "₹10,000+" band would
 * read as a broken filter rather than an empty segment.
 */
export const PRICE_OPTIONS = [
  { value: "0-1000", label: "Under ₹1,000", min: undefined, max: 999 },
  { value: "1000-1500", label: "₹1,000 – ₹1,500", min: 1000, max: 1500 },
  { value: "1500-2000", label: "₹1,500 – ₹2,000", min: 1500, max: 2000 },
  { value: "2000-", label: "₹2,000 and above", min: 2000, max: undefined },
] as const satisfies readonly {
  value: string;
  label: string;
  min: number | undefined;
  max: number | undefined;
}[];

export type PriceBandValue = (typeof PRICE_OPTIONS)[number]["value"];

/** Narrows an arbitrary `?status=` string to a status the rail may emit. */
export function resolveStatusFilter(
  value: string | undefined,
): PublicStatusValue | undefined {
  return PUBLIC_STATUS_VALUES.find((status) => status === value);
}

/**
 * Resolves a `?price=` param into numeric `searchMuns` bounds, or null when the
 * param is absent/unrecognised. Server and rail share this one table so a band
 * can never be labelled one thing and queried as another.
 */
export function resolvePriceBand(
  value: string | undefined,
): { min?: number; max?: number } | null {
  const band = PRICE_OPTIONS.find((option) => option.value === value);
  if (!band) return null;
  return { min: band.min, max: band.max };
}
