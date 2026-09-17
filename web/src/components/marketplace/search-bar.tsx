import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Marketplace search field — docs/prd/DESIGN-airtable.md `text-input` / `text-input-focus`.
 * 44px height, {rounded.sm} (6px), hairline border, focus recolors the border to
 * {colors.info-border} and adds the soft ring (both already encoded in
 * <Input>). The submit sits as a near-black `button-primary` at matching height.
 *
 * Still a real GET form to /muns (it works before JS loads), but with JS the
 * submit becomes an in-app navigation instead of a full page load. Hidden
 * inputs preserve the active rail filters so searching doesn't silently
 * discard the user's status/date/fee/location/sort choices; a new search
 * always starts from page 1.
 */

interface SearchBarProps {
  defaultValue?: string;
  /** Current rail filters, round-tripped so a search submit preserves them. */
  preserve?: Record<string, string | undefined>;
}

export function SearchBar({ defaultValue, preserve }: SearchBarProps) {
  const navigate = useNavigate();
  const hidden = Object.entries(preserve ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1]) && entry[0] !== "q" && entry[0] !== "page",
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams(hidden);
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (query) params.set("q", query);
    const qs = params.toString();
    navigate(qs ? `/muns?${qs}` : "/muns");
  };

  return (
    <form action="/muns" method="get" role="search" onSubmit={onSubmit} className="flex w-full items-center gap-xs">
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
          Search MUNs by name, city, theme or organizer
        </label>
        <Input
          // Re-mount when the URL's query changes (back button, chip removal)
          // so the uncontrolled field never shows a stale search.
          key={defaultValue ?? ""}
          id="mun-search"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search by name, city, theme or organizer"
          autoComplete="off"
          maxLength={200}
          className="peer pl-[42px] [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>

      <Button type="submit" size="sm" className="h-11 shrink-0 rounded-sm px-lg">
        Search
      </Button>
    </form>
  );
}
