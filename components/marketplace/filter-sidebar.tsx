"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { CheckIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "cn";

/**
 * `topic-filter-rail` — DESIGN-airtable.md § Cards & Containers.
 *
 * 240px left rail on {colors.canvas}, {typography.body-md}, vertically grouped
 * category headings with sub-bullets. The active item carries a small numeric
 * count badge. No boxed panel, no card chrome: the rail is type + whitespace
 * on the page floor, separated from results by a single hairline.
 *
 * Behaviour is unchanged from the previous implementation — every choice writes
 * a URLSearchParam and pushes to /muns, so the server component re-runs
 * `searchMuns` with the new params. This is a re-skin, not new logic.
 */

interface FilterSidebarProps {
  countries: string[];
  /** Result count for the current query — rendered as the active-item badge. */
  resultCount?: number;
}

const SORT_OPTIONS = [
  { value: "date", label: "Conference date" },
  { value: "price", label: "Lowest fee" },
  { value: "newest", label: "Newly listed" },
] as const;

/** A single selectable row in the rail. Active row gets ink type + a count badge. */
function RailOption({
  label,
  active,
  count,
  onSelect,
}: {
  label: string;
  active: boolean;
  count?: number;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-xs rounded-sm px-xs py-[6px] text-left text-body-md",
          "transition-colors duration-150 outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          active
            ? "bg-surface-soft font-medium text-ink"
            : "text-body hover:bg-surface-soft hover:text-ink dark:text-muted-foreground dark:hover:text-foreground",
        )}
      >
        <CheckIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-opacity duration-150",
            active ? "opacity-100" : "opacity-0",
          )}
          strokeWidth={2}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && count !== undefined && (
          <span className="shrink-0 rounded-pill bg-ink px-[6px] py-px font-mono text-[11px] leading-[1.45] tabular-nums text-background">
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

/** Grouped category heading + its sub-bullets. */
function RailGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-xs">
      <h3 className="px-xs text-caption uppercase tracking-[0.16px] text-muted-foreground">
        {heading}
      </h3>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  );
}

/** Long facet lists collapse to the first 6 entries behind a "Show all" toggle. */
function CollapsibleOptions({
  values,
  allLabel,
  selected,
  resultCount,
  onSelect,
}: {
  values: string[];
  allLabel: string;
  selected: string;
  resultCount?: number;
  onSelect: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 6;
  const needsToggle = values.length > LIMIT;
  // Keep an out-of-window selection visible instead of silently hiding it.
  const visible =
    expanded || !needsToggle
      ? values
      : values.slice(0, LIMIT).includes(selected) || !selected
        ? values.slice(0, LIMIT)
        : [selected, ...values.slice(0, LIMIT - 1)];

  return (
    <>
      <RailOption
        label={allLabel}
        active={selected === ""}
        count={selected === "" ? resultCount : undefined}
        onSelect={() => onSelect("")}
      />
      {visible.map((value) => (
        <RailOption
          key={value}
          label={value}
          active={selected === value}
          count={selected === value ? resultCount : undefined}
          onSelect={() => onSelect(value)}
        />
      ))}
      {needsToggle && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded-sm px-xs py-[6px] text-body-md text-link underline-offset-4 transition-colors duration-150 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? "Show less" : `Show all ${values.length}`}
          </button>
        </li>
      )}
    </>
  );
}

export function FilterSidebar({ countries, resultCount }: FilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `/muns?${qs}` : "/muns");
      });
    },
    [router, searchParams],
  );

  const selectedCity = searchParams.get("city") ?? "";
  const selectedCountry = searchParams.get("country") ?? "";
  const selectedSort = searchParams.get("sortBy") ?? "date";

  const activeFilters = [
    selectedCity && { key: "city", label: selectedCity },
    selectedCountry && { key: "country", label: selectedCountry },
    searchParams.get("q") && { key: "q", label: `"${searchParams.get("q")}"` },
  ].filter(Boolean) as { key: string; label: string }[];

  const hasFilters = activeFilters.length > 0 || searchParams.get("sortBy") !== null;

  const rail = (
    <div
      className={cn(
        "flex flex-col gap-lg transition-opacity duration-200",
        isPending && "opacity-60",
      )}
    >
      <RailGroup heading="Country">
        <CollapsibleOptions
          values={countries}
          allLabel="All countries"
          selected={selectedCountry}
          resultCount={resultCount}
          onSelect={(v) => setParam("country", v)}
        />
      </RailGroup>

      {/* No City group here. The nav bar's compact city picker (see
          `components/layout/site-header.tsx`) is now the single authoritative
          city control on every browse surface, and this rail used to render a
          second one that wrote the same `?city=` param — two controls for one
          param, disagreeing about which is canonical. The rail keeps the facets
          the nav does NOT carry. The active city still appears as a removable
          chip on mobile, read from the URL rather than from a `cities` prop. */}

      <RailGroup heading="Sort by">
        {SORT_OPTIONS.map((option) => (
          <RailOption
            key={option.value}
            label={option.label}
            active={selectedSort === option.value}
            onSelect={() => setParam("sortBy", option.value)}
          />
        ))}
      </RailGroup>

      {hasFilters && (
        <div className="border-t border-border pt-md">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-xs"
            onClick={() => startTransition(() => router.push("/muns"))}
          >
            <XIcon aria-hidden />
            Clear all filters
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: a trigger row + active-filter chips; the rail lives in a sheet. */}
      <div className="flex flex-wrap items-center gap-xs lg:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" size="sm">
                <SlidersHorizontalIcon aria-hidden />
                Filters
                {activeFilters.length > 0 && (
                  <span className="ml-xxs rounded-pill bg-ink px-[6px] py-px font-mono text-[11px] leading-[1.45] tabular-nums text-background">
                    {activeFilters.length}
                  </span>
                )}
              </Button>
            }
          />
          <SheetContent side="left" className="w-full sm:max-w-[320px]">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-lg pb-lg">{rail}</div>
          </SheetContent>
        </Sheet>

        {activeFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setParam(filter.key, "")}
            className="inline-flex items-center gap-xxs rounded-pill border border-border bg-background px-sm py-[5px] text-body-md text-body transition-colors duration-150 outline-none hover:bg-surface-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
          >
            {filter.label}
            <XIcon aria-hidden className="size-3" />
            <span className="sr-only">Remove filter</span>
          </button>
        ))}
      </div>

      {/* Desktop: the 240px rail, flush on the canvas with a hairline divider. */}
      <aside
        aria-label="Filter MUNs"
        className="hidden w-[240px] shrink-0 border-r border-border pr-xl lg:block"
      >
        <div className="sticky top-24">{rail}</div>
      </aside>
    </>
  );
}
