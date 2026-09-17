import { Link } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { MunCard } from "@/components/mun/mun-card";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { MunSummary } from "@/types";

/**
 * Horizontal-scroll strip of `MunCard`s — the "one row per intent" shelf
 * pattern, as opposed to `MunCardGrid`'s 3-up results grid. Same card,
 * different container: a grid says "these are all the results", a row says
 * "here's a slice, there are more".
 *
 * Scroll model is native overflow + CSS scroll-snap, not a JS transform track.
 * That means touch/trackpad momentum, shift-scroll, and keyboard scrolling all
 * work for free, and the row degrades to a plain scrollable list if JS never
 * hydrates. The arrow buttons only nudge `scrollLeft` — they're an enhancement
 * on top of a natively-scrollable element, and they're hidden below `md` where
 * swiping is the expected gesture anyway.
 *
 * Client component only because of the scroll-position state that enables and
 * disables the arrows. The card data itself is server-resolved.
 */

interface MunRowProps {
  title: string;
  /** One-line explanation of what the row actually selects for. */
  description?: string;
  muns: MunSummary[];
  /** "See all" destination — omit to hide the link. */
  seeAllHref?: string;
  className?: string;
}

export function MunRow({
  title,
  description,
  muns,
  seeAllHref,
  className,
}: MunRowProps) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncArrows = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const maxScroll = node.scrollWidth - node.clientWidth;
    // 1px tolerance: sub-pixel layout leaves scrollLeft at e.g. 412.66 when
    // the row is fully scrolled, which would otherwise keep "next" enabled
    // forever on a row that can't move.
    setCanScrollLeft(node.scrollLeft > 1);
    setCanScrollRight(node.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    syncArrows();
    // Re-check on resize too: a row that overflows at 1024px may fit at 1440px.
    const observer = new ResizeObserver(syncArrows);
    observer.observe(node);
    return () => observer.disconnect();
  }, [syncArrows, muns.length]);

  const scrollByPage = useCallback((direction: 1 | -1) => {
    const node = scrollerRef.current;
    if (!node) return;
    // Scroll by ~90% of the viewport so the edge card stays partly visible and
    // the user keeps their place, rather than a clean-break full page jump.
    node.scrollBy({
      left: direction * node.clientWidth * 0.9,
      behavior: "smooth",
    });
  }, []);

  // A row with nothing in it renders nothing at all — the caller decides
  // whether an empty state is warranted, a shelf never shows its own.
  if (muns.length === 0) return null;

  return (
    <section className={cn("flex flex-col gap-md", className)}>
      {/* Title block and controls sit on one line from `sm` up, but stack on
          narrow screens — side by side at 390px the description wraps to three
          lines and slides under the "See all" link. */}
      <div className="flex flex-col gap-xs sm:flex-row sm:items-end sm:justify-between sm:gap-md">
        <div className="min-w-0">
          <h2 className="font-display text-title-lg font-normal tracking-[-0.011em] text-ink">
            {title}
          </h2>
          {description && (
            <p className="mt-xxs text-body-md text-pretty text-body dark:text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-sm">
          {seeAllHref && (
            <Link
              to={seeAllHref}
              className="group/all inline-flex items-center gap-xxs rounded-sm text-body-md text-link transition-colors duration-150 outline-none hover:text-link-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              See all
              <span className="sr-only"> {title.toLowerCase()}</span>
              <ArrowRightIcon
                aria-hidden
                strokeWidth={1.75}
                className="size-3.5 transition-transform duration-150 ease-out group-hover/all:translate-x-px"
              />
            </Link>
          )}

          {/* Desktop-only scroll affordance. Hidden on touch widths where the
              row is swiped, not clicked. */}
          <div className="hidden items-center gap-xxs md:flex">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => scrollByPage(-1)}
              disabled={!canScrollLeft}
              aria-label={`Scroll ${title} left`}
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => scrollByPage(1)}
              disabled={!canScrollRight}
              aria-label={`Scroll ${title} right`}
            >
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      {/* The scroller stays inside the content container's padding box.
          An earlier version bled it to the viewport edge with `-mx-lg`, which
          pushed the row 24px past the container on both sides and gave the
          whole document ~300px of real horizontal scroll at 390px (verified:
          window.scrollX reached 305). Negative margins escape the container
          and nothing upstream clips them, so the bleed is not worth the bug —
          the partially-visible next card is already sufficient scroll
          affordance.

          `relative` is load-bearing: it makes the scroller the containing
          block for absolutely-positioned descendants (the cards' `sr-only`
          text). Without it those resolve against the viewport, escape the
          scroller's overflow clipping, and gave a 412px phone a ~3,400px-wide
          document once a row held a dozen cards. */}
      <ul
        ref={scrollerRef}
        onScroll={syncArrows}
        // Not focusable-by-default in every engine; tabIndex=0 guarantees the
        // row is reachable and arrow-key scrollable for keyboard users, since
        // the cards inside are links and don't scroll the container themselves.
        tabIndex={0}
        aria-label={title}
        className={cn(
          "relative flex snap-x snap-mandatory gap-lg overflow-x-auto pb-xs",
          "scroll-smooth motion-reduce:scroll-auto",
          "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {muns.map((mun) => (
          <li
            key={mun.id}
            // Fixed card width: `flex-1` would stretch a 2-card row into two
            // half-page slabs and lose the shelf read entirely.
            className="w-[280px] shrink-0 snap-start sm:w-[320px]"
          >
            <MunCard mun={mun} />
          </li>
        ))}
      </ul>
    </section>
  );
}
