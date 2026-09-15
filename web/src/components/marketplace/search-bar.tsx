import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Marketplace search field — DESIGN-airtable.md `text-input` / `text-input-focus`.
 * 44px height, {rounded.sm} (6px), hairline border, focus recolors the border to
 * {colors.info-border} and adds the soft ring (both already encoded in
 * <Input>). The submit sits as a near-black `button-primary` at matching height.
 *
 * Still a plain GET form to /muns — no JS needed, the server component picks up
 * `?q=` and runs `searchMuns`. Hidden inputs preserve any active rail filters so
 * searching doesn't silently discard the user's city/country/sort choices.
 */

interface SearchBarProps {
  defaultValue?: string;
  /** Current rail filters, round-tripped so a search submit preserves them. */
  preserve?: Record<string, string | undefined>;
}

export function SearchBar({ defaultValue, preserve }: SearchBarProps) {
  const hidden = Object.entries(preserve ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );

  return (
    <form action="/muns" method="get" role="search" className="flex w-full items-center gap-xs">
      {hidden.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}

      <div className="relative min-w-0 flex-1">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-md top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors duration-150 peer-focus:text-ink"
          strokeWidth={1.75}
        />
        <label htmlFor="mun-search" className="sr-only">
          Search MUNs by name or city
        </label>
        <Input
          id="mun-search"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search conferences by name or city"
          autoComplete="off"
          className="peer pl-[42px] [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>

      <Button type="submit" size="sm" className="h-11 shrink-0 rounded-sm px-lg">
        Search
      </Button>
    </form>
  );
}
