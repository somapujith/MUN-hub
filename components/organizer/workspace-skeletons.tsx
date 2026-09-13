import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";

/**
 * WORKSPACE SKELETON KIT
 * ============================================================================
 * The shared vocabulary every `loading.tsx` under `/organizer/dashboard` is
 * built from. Four pieces cover all 19 route segments because the workspace is
 * deliberately repetitive: a `<WorkspacePage>` frame wrapping either a table,
 * a stat strip, a form, or a not-yet-built placeholder.
 *
 * WHY THESE LIVE HERE AND NOT INLINE IN EACH loading.tsx
 * Geometry, not decoration, is the product of a skeleton. The frame below
 * copies `workspace-page.tsx`'s padding and `gap-lg` rhythm *exactly*; if that
 * component's density changes, one edit here keeps all 19 skeletons honest
 * rather than leaving eighteen of them silently drifting into layout shift.
 *
 * WHAT loading.tsx DOES *NOT* NEED TO DRAW
 * Both workspace layouts (`(workspace)/layout.tsx` and `[munId]/layout.tsx`)
 * render `<WorkspaceShell>` — sidebar, top bar, mun switcher — *above* the
 * Suspense boundary that `loading.tsx` fills. The shell is already painted and
 * stays painted while a section streams. So these skeletons draw the page body
 * only; drawing a fake sidebar would double it.
 *
 * Motion is suppressed under prefers-reduced-motion by the global rule in
 * globals.css, inherited via `<Skeleton>`.
 */

/* -------------------------------------------------------------------------- */
/* Frame                                                                      */
/* -------------------------------------------------------------------------- */

interface WorkspacePageSkeletonProps {
  /** Rough character-width of the real `<h1>`, so the bar isn't a random size. */
  titleWidth?: string;
  /** Set false for sections whose `<WorkspacePage>` has no `description`. */
  hasDescription?: boolean;
  /** Number of header action buttons to stand in for. 0 = no action cluster. */
  actions?: number;
  /**
   * Optional: `[munId]/loading.tsx` covers a route whose page only redirects,
   * so it renders the header frame and no body at all.
   */
  children?: React.ReactNode;
}

/**
 * Mirrors `components/organizer/workspace-page.tsx` geometry one-for-one:
 * same `max-w-[86rem]`, same responsive padding ramp, same `gap-lg` between
 * header and body, same `items-end justify-between` header row. The title bar
 * is `h-9` to match `text-title-lg`'s rendered box.
 */
export function WorkspacePageSkeleton({
  titleWidth = "14rem",
  hasDescription = true,
  actions = 0,
  children,
}: WorkspacePageSkeletonProps) {
  return (
    <div className="flex w-full max-w-[86rem] flex-1 flex-col gap-lg px-md py-lg sm:px-lg xl:px-xl xl:py-xl">
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-xxs">
          <Skeleton className="h-9" style={{ width: `min(100%, ${titleWidth})` }} />
          {hasDescription && (
            <div className="flex flex-col gap-xxs">
              <Skeleton className="h-3.5 w-[min(100%,38rem)]" />
              <Skeleton className="h-3.5 w-[min(100%,26rem)]" />
            </div>
          )}
        </div>
        {actions > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-xs">
            {Array.from({ length: actions }, (_, i) => (
              <Skeleton key={i} className="h-8 w-[9.5rem] rounded-lg" />
            ))}
          </div>
        )}
      </header>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bodies                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The hairline-gap summary strip used by Committees and Accommodation:
 * `gap-px` over a `bg-border` parent, so the 1px gutters read as rules rather
 * than whitespace. Matches `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`.
 */
export function StatStripSkeleton({ cells = 5 }: { cells?: number }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: cells }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-xxs bg-background px-md py-sm dark:bg-card"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * The bordered-card stat grid on the Overview page — a different shape from
 * `StatStripSkeleton` (separate cards, `gap-xs`, four up) and deliberately kept
 * separate rather than parameterised into one over-configurable component.
 */
export function StatCardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid gap-xs sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-xxs rounded-md border border-border bg-card p-md"
        >
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ))}
    </div>
  );
}

interface DashboardTableSkeletonProps {
  rows?: number;
  /** Column count for the `md`+ header rule. Mobile always collapses to rows. */
  columns?: number;
  /** Draw the uppercase column-header band above the rows. */
  header?: boolean;
  className?: string;
}

/**
 * A bordered, divided row list — the shape shared by the delegate roster, the
 * product table and the accommodation list. Deliberately *not* a real
 * `<table>`: the live tables switch to a card list below `lg`, and a skeleton
 * that reflows differently from the content it replaces defeats the point.
 * Flex rows reproduce both breakpoints with one tree.
 */
export function DashboardTableSkeleton({
  rows = 6,
  columns = 4,
  header = true,
  className,
}: DashboardTableSkeletonProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card",
        className,
      )}
    >
      {header && (
        <div className="hidden items-center gap-md border-b border-border bg-surface-soft px-md py-xs md:flex dark:bg-background/40">
          <Skeleton className="h-3 w-32" />
          {Array.from({ length: Math.max(0, columns - 2) }, (_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      )}
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-x-md gap-y-xs border-b border-border px-md py-sm last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Skeleton className="h-4 w-[min(100%,11rem)]" />
              <Skeleton className="h-3 w-[min(100%,7rem)]" />
            </div>
            {Array.from({ length: Math.max(0, columns - 2) }, (_, c) => (
              <Skeleton key={c} className="hidden h-4 w-24 md:block" />
            ))}
            <Skeleton className="h-5 w-20 rounded-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface DashboardFormSkeletonProps {
  /** Number of labelled inputs to draw. */
  fields?: number;
  /** Draw a full-width textarea block after the inputs. */
  textarea?: boolean;
  /** Draw a tab strip above the card — Setup renders one. */
  tabs?: number;
}

/**
 * A card containing labelled inputs and a submit button — Setup's General and
 * Dates & venue panels, and the shape any future settings/form module takes.
 * Two-up at `sm` because that's how `setup-forms.tsx` lays its fields out.
 */
export function DashboardFormSkeleton({
  fields = 4,
  textarea = false,
  tabs = 0,
}: DashboardFormSkeletonProps) {
  return (
    <div className="flex flex-col gap-xl">
      {tabs > 0 && (
        <div className="flex flex-wrap items-center gap-xs border-b border-border pb-xs">
          {Array.from({ length: tabs }, (_, i) => (
            <Skeleton key={i} className="h-8 w-28 rounded-sm" />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-lg rounded-md border border-border bg-card p-md xl:p-lg">
        <div className="grid gap-md sm:grid-cols-2">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className="flex flex-col gap-xxs">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full rounded-sm" />
            </div>
          ))}
        </div>

        {textarea && (
          <div className="flex flex-col gap-xxs">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-28 w-full rounded-sm" />
          </div>
        )}

        <div className="flex items-center gap-xs border-t border-border pt-md">
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * Stand-in for `components/organizer/module-placeholder.tsx` — the dashed
 * panel ten unbuilt sections currently render. Same dashed border, same
 * centred 48px avatar, same `py-xxl`, so those routes hand off without shift
 * even though what they hand off to is itself a placeholder.
 */
export function ModulePlaceholderSkeleton() {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl dark:bg-card">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex w-full max-w-prose flex-col items-center gap-xs">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-3.5 w-[min(100%,32rem)]" />
        <Skeleton className="h-3.5 w-[min(100%,22rem)]" />
      </div>
    </div>
  );
}
