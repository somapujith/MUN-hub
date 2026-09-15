import { useCallback, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CheckIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PRICE_OPTIONS, STATUS_OPTIONS } from "@/lib/home-filters";
import { cn } from "cn";

/**
 * `topic-filter-rail` — docs/prd/DESIGN-airtable.md § Cards & Containers — on the
 * homepage, mirrored to the right of the shelves.
 *
 * Structurally the same rail as `components/marketplace/filter-sidebar.tsx`
 * (grouped headings, check-marked options, count badge on the active row,
 * sheet on mobile), carrying the facets that surface does NOT: registration
 * status and price band. It deliberately omits city — that control moved into
 * the nav bar, and two city pickers on one screen disagreeing about which is
 * authoritative is worse than one.
 *
 * ---------------------------------------------------------------------------
 * EVERY OPTION HERE MAPS TO A REAL `searchMuns` PARAM
 * ---------------------------------------------------------------------------
 *   status  -> `MunSearchParams.status: MunStatus[]`
 *   price   -> `MunSearchParams.minPrice` / `maxPrice`, which filter on the
 *              cheapest active registration product (`min_price_sq`). Bands are
 *              sent as real numeric bounds, not a label the server re-guesses.
 *
 * The option tables themselves live in `lib/home-filters.ts` — a plain module,
 * so `app/page.tsx` can import the same bounds without crossing this file's
 * `"use client"` boundary (which hands a server component a client-reference
 * proxy rather than the array).
 *
 * Nothing is filtered client-side: each choice writes a URLSearchParam and
 * pushes, the server component re-runs `searchMuns`, and the shelves re-render
 * from the database.
 */

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

interface HomeFilterSidebarProps {
  /** Total rows matching the current filters — rendered as the active-item badge. */
  resultCount?: number;
}

export function HomeFilterSidebar({ resultCount }: HomeFilterSidebarProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
        // Stays on "/" — this rail only ever renders on the homepage, and the
        // city param it shares the URL with is parsed by the same page.
        navigate(qs ? `/?${qs}` : "/");
      });
    },
    [navigate, searchParams],
  );

  const selectedStatus = searchParams.get("status") ?? "";
  const selectedPrice = searchParams.get("price") ?? "";

  const activeCount = [selectedStatus, selectedPrice].filter(Boolean).length;

  const rail = (
    <div
      className={cn(
        "flex flex-col gap-lg transition-opacity duration-200",
        isPending && "opacity-60",
      )}
    >
      <RailGroup heading="Registration">
        <RailOption
          label="Any status"
          active={selectedStatus === ""}
          count={selectedStatus === "" ? resultCount : undefined}
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

      <RailGroup heading="Delegate fee">
        <RailOption
          label="Any fee"
          active={selectedPrice === ""}
          count={selectedPrice === "" ? resultCount : undefined}
          onSelect={() => setParam("price", "")}
        />
        {PRICE_OPTIONS.map((option) => (
          <RailOption
            key={option.value}
            label={option.label}
            active={selectedPrice === option.value}
            count={selectedPrice === option.value ? resultCount : undefined}
            onSelect={() => setParam("price", option.value)}
          />
        ))}
      </RailGroup>

      {activeCount > 0 && (
        <div className="border-t border-border pt-md">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-xs"
            onClick={() => {
              // Clears this rail's params only — the city lives in the nav bar
              // now, and a "clear filters" here must not reach up and undo a
              // control the user set somewhere else.
              const params = new URLSearchParams(searchParams.toString());
              params.delete("status");
              params.delete("price");
              const qs = params.toString();
              startTransition(() =>
                navigate(qs ? `/?${qs}` : "/"),
              );
            }}
          >
            <XIcon aria-hidden />
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile / tablet: a trigger button; the rail lives in a sheet. */}
      <div className="flex items-center gap-xs lg:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" size="sm">
                <SlidersHorizontalIcon aria-hidden />
                Filters
                {activeCount > 0 && (
                  <span className="ml-xxs rounded-pill bg-ink px-[6px] py-px font-mono text-[11px] leading-[1.45] tabular-nums text-background">
                    {activeCount}
                  </span>
                )}
              </Button>
            }
          />
          <SheetContent side="right" className="w-full sm:max-w-[320px]">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-lg pb-lg">{rail}</div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: the 240px rail on the right, hairline on its leading edge. */}
      <aside
        aria-label="Filter conferences"
        className="hidden w-[240px] shrink-0 border-l border-border pl-xl lg:block"
      >
        <div className="sticky top-24">{rail}</div>
      </aside>
    </>
  );
}
