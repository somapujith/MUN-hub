"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "cn";

/**
 * City pill row — the `topic-filter-rail` selection treatment (active row gets
 * ink type and a filled surface) re-laid as a horizontal pill strip for the
 * homepage, where a 240px vertical rail would fight the full-bleed carousel
 * above it.
 *
 * Deliberately not a native <select>: the option set is small and the choice
 * drives the whole page below it, so it should be visible, not hidden behind a
 * disclosure.
 *
 * Selection is a REAL navigation — `router.push` to `/?city=…`, which re-runs
 * the server component and re-queries `searchMuns` with the city filter. The
 * rows below are not client-side filtered; an unseeded city genuinely returns
 * zero rows from the database rather than hiding cards in the DOM.
 *
 * `useTransition` keeps the old rows on screen (dimmed) while the server
 * renders the new ones, instead of blanking the page.
 */

interface CitySelectorProps {
  cities: string[];
  /** Active city from the server-parsed `?city=` param. "" means all cities. */
  selected: string;
  className?: string;
}

export function CitySelector({ cities, selected, className }: CitySelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(city: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (city) {
      params.set("city", city);
    } else {
      params.delete("city");
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/?${qs}` : "/", { scroll: false });
    });
  }

  const options = [{ value: "", label: "All cities" }].concat(
    cities.map((city) => ({ value: city, label: city })),
  );

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
