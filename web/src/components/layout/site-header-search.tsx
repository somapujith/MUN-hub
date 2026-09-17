import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

/**
 * Nav-bar search — the same plain GET form as
 * `components/marketplace/search-bar.tsx` (no client JS: submit navigates to
 * `/muns?q=…` and the server component runs `searchMuns`), re-proportioned for
 * the 64px `top-nav`.
 *
 * Differences from the marketplace search bar, all deliberate:
 *   - 36px tall, not 44px. The doc's `text-input` height is 44px, which leaves
 *     10px of bar above and below inside a 64px nav and reads as a cramped slab.
 *     36px matches the nav's other controls (city trigger, "List your MUN").
 *   - No visible submit button. The bar has four other controls competing for
 *     width; Enter submits, and the magnifier carries the affordance.
 *   - Carries the active `?city=` through as a hidden input, so searching from
 *     the nav doesn't silently drop the city the user just picked in the nav.
 */

interface SiteHeaderSearchProps {
  /** Active city, round-tripped so a nav search preserves it. */
  city?: string;
  className?: string;
}

export function SiteHeaderSearch({ city, className }: SiteHeaderSearchProps) {
  return (
    <form
      action="/muns"
      method="get"
      role="search"
      className={cn("relative min-w-0", className)}
    >
      {city && <input type="hidden" name="city" value={city} />}

      <SearchIcon
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 left-sm size-3.5 -translate-y-1/2 text-muted-foreground transition-colors duration-150 peer-focus:text-ink"
      />
      <label htmlFor="nav-search" className="sr-only">
        Search MUNs by name or city
      </label>
      {/* Uncontrolled and intentionally value-less: this input must never
          reflect `?q=` from the URL. A `defaultValue` that changes on an
          already-mounted input is a Base UI console error (the nav persists
          across every client navigation, so it never remounts), and the
          marketplace page has its own search field that does show the active
          query. This one is always a fresh "search from anywhere" affordance. */}
      <Input
        id="nav-search"
        type="search"
        name="q"
        // Short enough to survive the phone nav, where "Search conferences" was
        // cut mid-word.
        placeholder="Search MUNs"
        autoComplete="off"
        className="peer h-9 pr-sm pl-[30px] md:text-body-md [&::-webkit-search-cancel-button]:appearance-none"
      />
    </form>
  );
}
