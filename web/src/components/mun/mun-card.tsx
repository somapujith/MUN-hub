import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpRightIcon, CalendarIcon, MapPinIcon } from "lucide-react";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatPrice } from "@/components/shared/currency";
import { formatDateRange } from "@/components/shared/date-range";
import { formatShortDate, safeLinkUrl } from "@/components/mun/mun-format";
import { RemoteImage } from "@/components/mun/remote-image";
import { cn } from "cn";
import type { MunSummary } from "@/types";

/**
 * MUN listing card — `demo-grid-card` treatment (docs/prd/DESIGN-airtable.md
 * § Cards & Containers) adapted for a search result: {colors.canvas} surface,
 * {rounded.md} (10px), hairline border, 16px internal padding, flat elevation
 * ("color-block first, shadow second" — no drop shadow anywhere).
 *
 * Deliberately equal heights: the doc's uneven-height rule is a marketing-grid
 * pattern. A results grid has to stay scannable, so every card runs the same
 * three-row rhythm — title + status, meta, then a footer rule with organizer
 * and fee. The fee sits in tabular figures so prices align down the column.
 *
 * Hover is restrained per the system's no-hover doctrine: a border tone shift
 * and the arrow sliding in, never a lift or a color change.
 */

interface MunCardProps {
  mun: MunSummary;
}

export function MunCard({ mun }: MunCardProps) {
  const location = [mun.city, mun.country].filter(Boolean).join(", ");
  const hasLocation = location.length > 0;
  const hasDates = Boolean(mun.startDate);
  const cover = safeLinkUrl(mun.coverImage);
  // Render-time clock, read once per card mount.
  const [now] = useState(() => Date.now());
  // Only an open MUN's upcoming deadline is worth a line on the card.
  const closesAt =
    mun.status === "REGISTRATION_OPEN" &&
    mun.registrationDeadline &&
    mun.registrationDeadline.getTime() > now
      ? mun.registrationDeadline
      : null;

  return (
    <article className="h-full">
      <Link
        to={`/mun/${mun.slug}`}
        className={cn(
          "flex h-full flex-col gap-sm overflow-hidden rounded-md border border-border bg-card p-md",
          "transition-[border-color,background-color] duration-150 ease-out outline-none",
          "hover:border-border-strong hover:bg-surface-soft",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
          "dark:hover:bg-accent",
        )}
      >
        {/* The organizer's cover photo, bled to the card edge. Decorative —
            the title below names the conference. */}
        {cover && (
          <RemoteImage
            src={cover}
            alt=""
            className="-mx-md -mt-md mb-xxs aspect-[16/9] w-[calc(100%_+_2_*_var(--spacing-md))] max-w-none bg-surface-soft object-cover"
          />
        )}

        <div className="flex items-start justify-between gap-sm">
          <h3 className="min-w-0 font-display text-label-md font-medium leading-[1.35] tracking-[-0.006em] text-balance text-ink">
            {mun.name}
          </h3>
          <ArrowUpRightIcon
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out [a:focus-visible_&]:translate-x-0 [a:focus-visible_&]:opacity-100 [a:hover_&]:translate-x-0 [a:hover_&]:opacity-100"
          />
        </div>

        <dl className="flex flex-col gap-xxs text-body-md text-body dark:text-muted-foreground">
          <div className="flex items-center gap-xs">
            <dt className="sr-only">Location</dt>
            <MapPinIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <dd className={cn("min-w-0 truncate", !hasLocation && "text-muted-foreground")}>
              {hasLocation ? location : "Location to be announced"}
            </dd>
          </div>
          <div className="flex items-center gap-xs">
            <dt className="sr-only">Dates</dt>
            <CalendarIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <dd className={cn("min-w-0 truncate", !hasDates && "text-muted-foreground")}>
              {formatDateRange(mun.startDate, mun.endDate)}
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex flex-wrap items-center gap-x-xs gap-y-xxs pt-xs">
          <MunStatusBadge status={mun.status} audience="public" />
          {closesAt && (
            <span className="text-body-md text-muted-foreground">
              Closes <time dateTime={closesAt.toISOString()}>{formatShortDate(closesAt)}</time>
            </span>
          )}
        </div>

        <div className="-mx-md mt-sm flex items-center justify-between gap-sm border-t border-border px-md pt-sm">
          <span className="min-w-0 truncate text-body-md text-muted-foreground">
            {mun.organizerName ?? "Independent organizer"}
          </span>
          <span className="shrink-0 text-label-md tabular-nums text-ink">
            {formatPrice(mun.minPrice)}
          </span>
        </div>
      </Link>
    </article>
  );
}
