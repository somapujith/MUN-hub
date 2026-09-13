import type { Committee, Portfolio } from "@/lib/types";

/**
 * A committee row as the board renders it: the frozen `Committee` shape plus
 * the portfolios the server already resolved for it.
 *
 * Intentionally NOT `CommitteeWithPortfolios` from `lib/types` — that type is
 * the marketplace's public projection and this module must not start depending
 * on the marketplace read shape. Structurally identical today; decoupled on
 * purpose so a change to one doesn't silently retype the other.
 */
export interface CommitteeRow extends Committee {
  portfolios: Portfolio[];
}

/** Sum of `availability` across a committee's portfolios — real, entered data. */
export function seatsConfigured(portfolios: Portfolio[]): number {
  return portfolios.reduce((total, portfolio) => total + portfolio.availability, 0);
}
