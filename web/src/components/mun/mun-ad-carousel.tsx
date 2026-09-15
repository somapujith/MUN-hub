import { Link } from "react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardActions,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import { formatDateRange } from "@/components/shared/date-range";
import { formatPrice } from "@/components/shared/currency";
import { cn } from "cn";
import type { MunSummary } from "@/types";

/**
 * Rotating promo banner — a full-bleed `signature-card` per slide, cycling
 * coral -> forest -> dark so consecutive slides never repeat a surface mode
 * (DESIGN-airtable.md Don't #5). This is the one place the homepage shows the
 * same structural band more than once in a row, which is exactly why the
 * surface rotates underneath it.
 *
 * Client component purely for the rotation timer and interaction state. It
 * never fetches: `slides` are resolved server-side in `app/page.tsx` from
 * `searchMuns` and handed down as props.
 *
 * Behaviour:
 *   - auto-advances every 5s
 *   - pauses on pointer hover, on keyboard focus inside the region, and
 *     whenever the tab is hidden (a background timer burning through slides is
 *     just wasted work)
 *   - prev/next arrows + dot indicators, all real <button>s, all reachable by
 *     keyboard, with the arrow-key semantics of a tablist on the dot row
 *   - honours `prefers-reduced-motion`: no auto-rotation at all, since an
 *     unrequested 5s content swap is the exact thing that setting opts out of
 *
 * A11y: the region is `aria-roledescription="carousel"` with
 * `aria-live="polite"` on the slide container, which only announces when
 * rotation is paused (per APG: live regions on auto-rotating carousels should
 * be "off" while playing to avoid a screen reader reading every 5 seconds).
 */

const ROTATE_MS = 5000;

/** Surface rotation — index-modulo so any slide count stays on-rhythm. */
const SLIDE_VARIANTS = ["coral", "forest", "dark"] as const;

interface MunAdCarouselProps {
  slides: MunSummary[];
  className?: string;
}

export function MunAdCarousel({ slides, className }: MunAdCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const regionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const count = slides.length;

  const goTo = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // Respect the OS reduced-motion setting, and keep respecting it if the user
  // flips it while the page is open.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Don't rotate a hidden tab.
  useEffect(() => {
    const sync = () => setPaused(document.hidden ? true : (p) => p && false);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // The rotation timer. Keyed on `index` so every manual advance also resets
  // the clock — otherwise clicking "next" at t=4.9s flashes two slides.
  useEffect(() => {
    if (paused || reducedMotion || count < 2) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % count);
    }, ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, reducedMotion, count]);

  if (count === 0) return null;

  const isPaused = paused || reducedMotion || count < 2;

  return (
    <section
      ref={containerRef}
      aria-roledescription="carousel"
      aria-label="Featured conferences"
      className={cn("relative", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        // Only resume once focus has genuinely left the carousel, not when it
        // moves between the arrows and the dots.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div
        id={regionId}
        aria-live={isPaused ? "polite" : "off"}
        className="relative"
      >
        {slides.map((mun, slideIndex) => {
          const active = slideIndex === index;
          const variant = SLIDE_VARIANTS[slideIndex % SLIDE_VARIANTS.length];
          const location = [mun.city, mun.country].filter(Boolean).join(", ");

          return (
            <div
              key={mun.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${slideIndex + 1} of ${count}: ${mun.name}`}
              aria-hidden={!active}
              // Stacked, not carousel-translated: each slide is absolutely
              // positioned over the first, which stays in flow to set the
              // height. Cross-fade instead of a slide transform so a long
              // conference name can't cause a horizontal scrollbar mid-animation.
              className={cn(
                slideIndex === 0 ? "relative" : "absolute inset-0",
                "transition-opacity duration-300 ease-out motion-reduce:transition-none",
                active
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              // React 19 wants a real boolean here — `inert=""` logs a
              // "Received an empty string for a boolean attribute" warning.
              inert={!active}
            >
              <SignatureCard
                variant={variant}
                className="min-h-[320px] justify-center sm:min-h-[360px]"
              >
                <div className="max-w-2xl">
                  <SignatureCardEyebrow>
                    {mun.status === "REGISTRATION_OPEN"
                      ? "Registration open"
                      : "Featured conference"}
                  </SignatureCardEyebrow>

                  <SignatureCardTitle className="sm:text-display-md lg:text-display-lg">
                    {mun.name}
                  </SignatureCardTitle>

                  <dl className="mt-lg flex flex-wrap items-center gap-x-lg gap-y-xs text-body-md opacity-85">
                    <div className="flex items-center gap-xs">
                      <dt className="sr-only">Location</dt>
                      <MapPinIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-3.5 shrink-0"
                      />
                      <dd>{location || "Location to be announced"}</dd>
                    </div>
                    <div className="flex items-center gap-xs">
                      <dt className="sr-only">Dates</dt>
                      <CalendarIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-3.5 shrink-0"
                      />
                      <dd>{formatDateRange(mun.startDate, mun.endDate)}</dd>
                    </div>
                    <div className="flex items-center gap-xs">
                      <dt className="sr-only">Delegate fee from</dt>
                      <dd className="tabular-nums">
                        From {formatPrice(mun.minPrice)}
                      </dd>
                    </div>
                  </dl>

                  <SignatureCardActions>
                    <Button
                      variant="on-dark"
                      // Only the active slide is a real tab stop — the hidden
                      // slides keep their CTA out of the tab order.
                      tabIndex={active ? undefined : -1}
                      render={<Link to={`/mun/${mun.slug}`} />}
                    >
                      View conference
                    </Button>
                  </SignatureCardActions>
                </div>
              </SignatureCard>
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <div className="mt-md flex items-center justify-between gap-md">
          {/* Dots. A tablist rather than plain buttons so arrow keys work. */}
          <div
            role="tablist"
            aria-label="Choose a featured conference"
            className="flex items-center gap-xs"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                next();
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                prev();
              }
            }}
          >
            {slides.map((mun, dotIndex) => {
              const active = dotIndex === index;
              return (
                <button
                  key={mun.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={regionId}
                  tabIndex={active ? 0 : -1}
                  onClick={() => goTo(dotIndex)}
                  // 8px dot inside a 24px hit area — the visual dot stays
                  // small while the touch target clears 24px in both axes.
                  className={cn(
                    "group/dot grid size-6 place-items-center rounded-sm outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  )}
                >
                  <span className="sr-only">
                    Show slide {dotIndex + 1}: {mun.name}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "block h-2 rounded-pill transition-[width,background-color] duration-200 ease-out",
                      active
                        ? "w-6 bg-ink dark:bg-foreground"
                        : "w-2 bg-border-strong group-hover/dot:bg-ink dark:group-hover/dot:bg-foreground",
                    )}
                  />
                </button>
              );
            })}
          </div>

          {/* button-icon-circular pair (doc § Buttons) */}
          <div className="flex items-center gap-xs">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={prev}
              aria-label="Previous conference"
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={next}
              aria-label="Next conference"
            >
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
