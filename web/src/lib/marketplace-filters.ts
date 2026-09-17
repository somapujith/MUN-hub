import type { MunSearchParams, MunSortBy } from "@/api/marketplace";
import { resolvePriceBand, resolveStatusFilter } from "@/lib/home-filters";

/**
 * URL vocabulary of the /muns marketplace page, shared by the page (which
 * turns it into a `searchMuns` call) and the filter rail (which writes it), so
 * the two can never disagree about what a param means.
 *
 *   q        free text (name, city, country, theme, organizer)
 *   city     exact city (the nav bar's city picker writes this)
 *   country  exact country
 *   status   REGISTRATION_OPEN | PUBLISHED | REGISTRATION_CLOSED
 *   price    a PRICE_OPTIONS band value from lib/home-filters.ts
 *   from/to  YYYY-MM-DD, the visitor's local calendar days; the conference
 *            must overlap [from 00:00, to 23:59:59.999]
 *   sortBy   date | deadline | price | newest
 *   page     1-based page number
 */

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

  return {
    query: searchParams.get("q")?.trim() || undefined,
    city: searchParams.get("city") || undefined,
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
