import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useTransition } from "react";
import { ChevronDownIcon, MapPinIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";

/**
 * City selection control, in two shapes that share one navigation model.
 *
 *   variant="pills"    horizontal pill strip — the `topic-filter-rail` selection
 *                      treatment (active row gets ink type + filled surface)
 *                      re-laid horizontally for a page body, where a 240px
 *                      vertical rail would fight the carousel above it.
 *   variant="compact"  a single "Mumbai ▾" trigger opening a radio dropdown —
 *                      sized for the 64px `top-nav`, where a pill strip can't fit.
 *
 * Both variants are REAL navigation: they rewrite `?city=` and push, which
 * re-runs the server component and re-queries `searchMuns` with the city filter.
 * Nothing is client-side filtered; an unseeded city genuinely returns zero rows
 * from the database rather than hiding cards in the DOM.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TARGET PATH DIFFERS PER VARIANT
 * ---------------------------------------------------------------------------
 * The pill strip only ever renders on `/`, so it pushes to `/?city=…`.
 *
 * The compact variant lives in the nav bar, which renders on `/mun/[slug]`,
 * `/dashboard`, `/login` — pages that read no `?city=` param at all. Writing
 * `?city=Mumbai` onto `/mun/hyd-mun-2026` would produce a URL that claims a
 * filter the page ignores. So the compact variant always navigates to a surface
 * that actually consumes the param: it stays put on `/` and `/muns` (preserving
 * the rest of the query string), and routes anywhere else to `/?city=…`.
 * That makes "pick a city from the nav" mean the same thing on every page.
 *
 * `useTransition` keeps the old rows on screen (dimmed) while the server renders
 * the new ones, instead of blanking the page.
 */

type CitySelectorVariant = "pills" | "compact";

interface CitySelectorProps {
  cities: string[];
  /** Active city from the server-parsed `?city=` param. "" means all cities. */
  selected: string;
  variant?: CitySelectorVariant;
  className?: string;
}

const ALL_CITIES_LABEL = "All cities";

/** Sentinel for "no city" — Base UI's radio group needs a non-empty value. */
const ALL_VALUE = "__all__";

/** Paths that actually read `?city=` and re-query on it. */
const CITY_AWARE_PATHS = ["/", "/muns"];

export function CitySelector({
  cities,
  selected,
  variant = "pills",
  className,
}: CitySelectorProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(city: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (city) {
      params.set("city", city);
    } else {
      params.delete("city");
    }
    // Any city change invalidates the current page cursor.
    params.delete("page");

    // Pills only ever live on "/". Compact lives in the nav on every page, so
    // it falls back to "/" from pages that don't consume the param.
    const basePath =
      variant === "pills" || CITY_AWARE_PATHS.includes(pathname) ? pathname : "/";

    const qs = params.toString();
    startTransition(() => {
      navigate(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  const options = [{ value: "", label: ALL_CITIES_LABEL }].concat(
    cities.map((city) => ({ value: city, label: city })),
  );

  if (variant === "compact") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-9 max-w-[168px] items-center gap-xxs rounded-sm border border-border bg-background px-sm",
            "text-body-md whitespace-nowrap transition-colors duration-150 outline-none",
            "hover:border-border-strong hover:bg-surface-soft",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "aria-expanded:bg-surface-soft",
            isPending && "opacity-60",
            className,
          )}
          aria-label={
            selected ? `City: ${selected}. Change city` : "Choose a city"
          }
        >
          <MapPinIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span
            className={cn(
              "min-w-0 truncate",
              selected ? "font-medium text-ink" : "text-body dark:text-muted-foreground",
            )}
          >
            {selected || ALL_CITIES_LABEL}
          </span>
          <ChevronDownIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </DropdownMenuTrigger>

        {/* `w-(--anchor-width)` on the shared popup would clamp this to the
            168px trigger and truncate every city name — override to a readable
            fixed width and cap the height so a long city list scrolls. */}
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="max-h-[min(360px,var(--available-height))] w-56!"
        >
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={selected || ALL_VALUE}
              onValueChange={(value) =>
                select(value === ALL_VALUE ? "" : String(value))
              }
            >
              {options.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value || ALL_VALUE}
                  value={option.value || ALL_VALUE}
                >
                  <span className="truncate">{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <nav
      aria-label="Filter conferences by city"
      className={cn(
        "transition-opacity duration-200",
        isPending && "opacity-60",
        className,
      )}
    >
      {/* Scrolls horizontally on mobile rather than wrapping to three ragged
          rows once the city list grows; wraps normally from `lg` up.
          No negative-margin bleed here — see the note in `mun-row.tsx`: it
          escapes the content container and gives the document real horizontal
          page scroll on mobile. */}
      <ul className="flex snap-x snap-mandatory gap-xs overflow-x-auto pb-xxs lg:flex-wrap lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <li key={option.value || "__all"} className="snap-start">
              <button
                type="button"
                onClick={() => select(option.value)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-pill border px-md whitespace-nowrap",
                  "text-body-md transition-colors duration-150 ease-out outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-transparent bg-ink font-medium text-background dark:bg-foreground"
                    : "border-border bg-background text-body hover:border-border-strong hover:bg-surface-soft hover:text-ink dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
