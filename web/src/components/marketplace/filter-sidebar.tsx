import { useNavigate, useSearchParams } from "react-router";
import { useCallback, useId, useState, useTransition } from "react";
import { CheckIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PRICE_OPTIONS, STATUS_OPTIONS } from "@/lib/home-filters";
import {
  addDays,
  DATE_PRESETS,
  matchingDatePreset,
  parseDateParam,
  SORT_OPTIONS,
  toDateParam,
} from "@/lib/marketplace-filters";
import { cn } from "cn";

/**
 * `topic-filter-rail` — docs/prd/DESIGN-airtable.md § Cards & Containers.
 *
 * 240px left rail on {colors.canvas}, {typography.body-md}, vertically grouped
 * category headings with sub-bullets. The active item carries a small numeric
 * count badge. No boxed panel, no card chrome: the rail is type + whitespace
 * on the page floor, separated from results by a single hairline.
 *
 * Every choice writes a URLSearchParam (vocabulary in
 * lib/marketplace-filters.ts) and navigates, so the page re-runs `searchMuns`
 * with the new params and any filtered view is a shareable link. Changing a
 * filter always drops `page` — page 3 of the old result set means nothing in
 * the new one.
 */

interface FilterSidebarProps {
  countries: string[];
  /** Result count for the current query — rendered as the active-item badge. */
  resultCount?: number;
}

// text-body-md is applied outside cn(): cn drops a custom text-* size token
// when a text colour class follows it.
const OPTION_BASE =
  "group flex w-full items-center gap-xs rounded-sm px-xs py-[6px] text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

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
        aria-pressed={active}
        className={`text-body-md ${cn(
          OPTION_BASE,
          active
            ? "bg-surface-soft font-medium text-ink"
            : "text-body hover:bg-surface-soft hover:text-ink dark:text-muted-foreground dark:hover:text-foreground",
        )}`}
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
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-xs">
      <h3 id={headingId} className="px-xs text-caption uppercase tracking-[0.16px] text-muted-foreground">
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

/** A committed date must be a real calendar day in a sensible year range. */
function isCommittableDate(value: string): boolean {
  const date = parseDateParam(value);
  return date !== null && date.getFullYear() >= 2000 && date.getFullYear() <= 2100;
}

/**
 * Native date input that keeps its own draft while the visitor types (a
 * half-typed year like 0002 is not a date yet) and commits only a complete,
 * plausible date — or an empty value — to the URL.
 */
function DateField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onCommit: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    // The URL changed underneath us (preset, chip removal, back button).
    setSyncedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex flex-col gap-xxs">
      {/* Plain <label>: <Label> routes classes through cn(), which would drop
          the text-caption size token next to a colour. */}
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="date"
        value={draft}
        min={min}
        max={max}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next === "" || isCommittableDate(next)) onCommit(next);
        }}
        className="h-9 px-xs"
      />
    </div>
  );
}

/** Date presets plus a custom from/to pair. */
function DateRangeControls({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const today = new Date();
  const activePreset = matchingDatePreset(from || null, to || null, today);
  const hasRange = Boolean(from || to);

  return (
    <>
      <RailOption label="Any dates" active={!hasRange} onSelect={() => onChange({ from: "", to: "" })} />
      {DATE_PRESETS.map((preset) => (
        <RailOption
          key={preset.value}
          label={preset.label}
          active={activePreset === preset.value}
          onSelect={() =>
            onChange({ from: toDateParam(today), to: toDateParam(addDays(today, preset.days)) })
          }
        />
      ))}
      {/* Stacked: two native date inputs side by side don't fit the 240px rail. */}
      <li className="mt-xs grid grid-cols-1 gap-xs px-xs">
        <DateField label="From" value={from} max={to || undefined} onCommit={(next) => onChange({ from: next, to })} />
        <DateField label="To" value={to} min={from || undefined} onCommit={(next) => onChange({ from, to: next })} />
      </li>
    </>
  );
}

const dateChipFormatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

function dateChipLabel(from: string, to: string): string {
  const fromDate = parseDateParam(from);
  const toDate = parseDateParam(to);
  if (fromDate && toDate) return `${dateChipFormatter.format(fromDate)} – ${dateChipFormatter.format(toDate)}`;
  if (fromDate) return `From ${dateChipFormatter.format(fromDate)}`;
  if (toDate) return `Until ${dateChipFormatter.format(toDate)}`;
  return "Dates";
}

export function FilterSidebar({ countries, resultCount }: FilterSidebarProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const setParams = useCallback(
    (updates: Record<string, string>) => {
      // Start from the live URL, not the render-time `searchParams`: while an
      // earlier filter's navigation is still pending (it runs in a
      // transition) the hook value is stale, and a quick second click would
      // silently drop the first filter.
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      params.delete("page");
      const qs = params.toString();
      startTransition(() => {
        navigate(qs ? `/muns?${qs}` : "/muns");
      });
    },
    [navigate],
  );

  const setParam = useCallback((key: string, value: string) => setParams({ [key]: value }), [setParams]);

  const selectedCity = searchParams.get("city") ?? "";
  const selectedCountry = searchParams.get("country") ?? "";
  const selectedStatus = searchParams.get("status") ?? "";
  const selectedPrice = searchParams.get("price") ?? "";
  const selectedFrom = parseDateParam(searchParams.get("from")) ? (searchParams.get("from") ?? "") : "";
  const selectedTo = parseDateParam(searchParams.get("to")) ? (searchParams.get("to") ?? "") : "";
  const selectedSort = searchParams.get("sortBy") ?? "date";
  const query = searchParams.get("q");

  const statusLabel = STATUS_OPTIONS.find((option) => option.value === selectedStatus)?.label;
  const priceLabel = PRICE_OPTIONS.find((option) => option.value === selectedPrice)?.label;

  const activeFilters = [
    query && { keys: ["q"], label: `"${query}"` },
    selectedCity && { keys: ["city"], label: selectedCity },
    selectedCountry && { keys: ["country"], label: selectedCountry },
    statusLabel && { keys: ["status"], label: statusLabel },
    priceLabel && { keys: ["price"], label: priceLabel },
    (selectedFrom || selectedTo) && { keys: ["from", "to"], label: dateChipLabel(selectedFrom, selectedTo) },
  ].filter(Boolean) as { keys: string[]; label: string }[];

  const hasFilters = activeFilters.length > 0 || searchParams.get("sortBy") !== null;

  const clearKeys = (keys: string[]) => setParams(Object.fromEntries(keys.map((key) => [key, ""])));

  const rail = (
    <div
      className={cn(
        "flex flex-col gap-lg transition-opacity duration-200",
        isPending && "opacity-60",
      )}
    >
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

      <RailGroup heading="Registration">
        <RailOption
          label="Any status"
          active={!statusLabel}
          count={!statusLabel ? resultCount : undefined}
          onSelect={() => setParam("status", "")}
        />
        {STATUS_OPTIONS.map((option) => (
          <RailOption
            key={option.value}
            label={option.label}
            active={selectedStatus === option.value}
            count={selectedStatus === option.value ? resultCount : undefined}
            onSelect={() => setParam("status", option.value)}
          />
        ))}
      </RailGroup>

      <RailGroup heading="Conference dates">
        <DateRangeControls
          from={selectedFrom}
          to={selectedTo}
          onChange={({ from, to }) => setParams({ from, to })}
        />
      </RailGroup>

      <RailGroup heading="Delegate fee">
        <RailOption label="Any fee" active={!priceLabel} onSelect={() => setParam("price", "")} />
        {PRICE_OPTIONS.map((option) => (
          <RailOption
            key={option.value}
            label={option.label}
            active={selectedPrice === option.value}
            onSelect={() => setParam("price", option.value)}
          />
        ))}
      </RailGroup>

      <RailGroup heading="Country">
        <CollapsibleOptions
          values={countries}
          allLabel="All countries"
          selected={selectedCountry}
          onSelect={(v) => setParam("country", v)}
        />
      </RailGroup>

      {/* No City group here. The nav bar's compact city picker (see
          `components/layout/site-header.tsx`) is the single authoritative
          city control on every browse surface; a second one in this rail
          would write the same `?city=` param. The active city still appears
          as a removable chip, read from the URL. */}

      {hasFilters && (
        <div className="border-t border-border pt-md">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-xs"
            onClick={() => startTransition(() => navigate("/muns"))}
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
            key={filter.keys.join("-")}
            type="button"
            onClick={() => clearKeys(filter.keys)}
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
        {/* Capped to the viewport so the lower groups stay reachable while
            the rail is stuck. */}
        <div className="sticky top-24 -mx-1 max-h-[calc(100dvh-7rem)] overflow-y-auto px-1 pb-md">{rail}</div>
      </aside>
    </>
  );
}
