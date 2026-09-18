import type { MunSearchParams, MunSortBy } from "@/api/marketplace";
import { resolvePriceBand, resolveStatusFilter } from "@/lib/home-filters";

/**
 * URL vocabulary of the /muns marketplace page, shared by the page (which
 * turns it into a `searchMuns` call) and the filter rail (which writes it), so
 * the two can never disagree about what a param means.
 *
 *   q        free text (name, city, country, theme, organizer)
 *   city     exact city (the nav bar's city picker writes this), or the
 *            literal "all" — see ALL_CITIES_PARAM
 *   country  exact country
 *   status   REGISTRATION_OPEN | PUBLISHED | REGISTRATION_CLOSED
 *   price    a PRICE_OPTIONS band value from lib/home-filters.ts
 *   from/to  YYYY-MM-DD, the visitor's local calendar days; the conference
 *            must overlap [from 00:00, to 23:59:59.999]
 *   sortBy   date | deadline | price | newest
 *   page     1-based page number
 */

/**
 * Explicit "every city" marker `?city=` can carry, distinct from the param
 * being absent. Needed because the home page defaults a missing `city` to
 * DEFAULT_CITY (below) — without a dedicated marker, clearing the picker back
 * to "All cities" would just delete the param and the page would immediately
 * re-apply the default, making "All cities" unreachable.
 */
export const ALL_CITIES_PARAM = "all";

/**
 * The home page's city when a visitor arrives with no `?city=` at all.
 * Hyderabad is MUN Hub's primary market (the seeded conference set is
 * concentrated there) — new visitors land on a populated, relevant shelf
 * instead of an undifferentiated nationwide list. Only the home page applies
 * this; `/muns` (the full marketplace search) still defaults to every city,
 * matching its "browse everything" framing.
 */
export const DEFAULT_CITY = "Hyderabad";

/**
 * Resolves `?city=` against the known facet list.
 *   - absent              -> `fallback` (caller's own "nothing chosen yet" default)
 *   - ALL_CITIES_PARAM     -> "" (explicitly every city — never re-defaulted)
 *   - a known city         -> that city
 *   - anything else        -> "" (stale/bad link, same as explicit "all")
 */
export function resolveCityParam(raw: string | null, cities: string[], fallback = ""): string {
  if (raw === null) return cities.includes(fallback) ? fallback : "";
  if (raw === ALL_CITIES_PARAM) return "";
  return cities.includes(raw) ? raw : "";
}

export const SORT_OPTIONS: readonly { value: MunSortBy; label: string }[] = [
  { value: "date", label: "Conference date" },
  { value: "deadline", label: "Closing soonest" },
  { value: "price", label: "Lowest fee" },
  { value: "newest", label: "Newly listed" },
];

export function resolveSort(value: string | null | undefined): MunSortBy | undefined {
  return SORT_OPTIONS.find((option) => option.value === value)?.value;
}

const DATE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a `YYYY-MM-DD` param as local midnight; null for anything else (including impossible dates). */
export function parseDateParam(value: string | null | undefined): Date | null {
  const match = value ? DATE_PARAM.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Local calendar day as `YYYY-MM-DD`. */
export function toDateParam(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function endOfLocalDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Quick date windows offered above the custom range inputs. */
export const DATE_PRESETS = [
  { value: "30", label: "Next 30 days", days: 30 },
  { value: "90", label: "Next 3 months", days: 90 },
  { value: "180", label: "Next 6 months", days: 180 },
] as const;

/** The preset a from/to pair corresponds to (starting today), if any. */
export function matchingDatePreset(from: string | null, to: string | null, today = new Date()): string | null {
  if (!from || !to || from !== toDateParam(today)) return null;
  return DATE_PRESETS.find((preset) => toDateParam(addDays(today, preset.days)) === to)?.value ?? null;
}

/**
 * Builds the `searchMuns` params for the current URL. Unknown or malformed
 * values are ignored, never sent. A reversed date range is swapped rather than
 * silently returning nothing.
 */
export function resolveMarketplaceSearch(
  searchParams: URLSearchParams,
  paging: { limit: number; offset: number },
): MunSearchParams {
  const status = resolveStatusFilter(searchParams.get("status") ?? undefined);
  const priceBand = resolvePriceBand(searchParams.get("price") ?? undefined);

  let from = parseDateParam(searchParams.get("from"));
  let to = parseDateParam(searchParams.get("to"));
  if (from && to && from.getTime() > to.getTime()) {
    [from, to] = [to, from];
  }

  const rawCity = searchParams.get("city");

  return {
    query: searchParams.get("q")?.trim() || undefined,
    city: rawCity && rawCity !== ALL_CITIES_PARAM ? rawCity : undefined,
    country: searchParams.get("country") || undefined,
    status: status ? [status] : undefined,
    minPrice: priceBand?.min,
    maxPrice: priceBand?.max,
    dateFrom: from ?? undefined,
    dateTo: to ? endOfLocalDay(to) : undefined,
    sortBy: resolveSort(searchParams.get("sortBy")),
    limit: paging.limit,
    offset: paging.offset,
  };
}

/** Params the rail and search box carry between each other (everything except paging). */
export const FILTER_PARAM_KEYS = ["q", "city", "country", "status", "price", "from", "to", "sortBy"] as const;
