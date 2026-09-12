import Link from "next/link";
import { ArrowUpRightIcon, CalendarIcon, MapPinIcon, UsersIcon } from "lucide-react";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import { cn } from "cn";
import type { MunStatus } from "@/lib/db/schema-enums";
import type { OrganizerMunRow } from "./queries";

/**
 * One owned conference on the organizer dashboard.
 *
 * Unlike the public `MunCard`, the headline datum is operational: seats sold
 * against capacity, shown as a number plus a fill bar. The bar is decorative
 * (`aria-hidden`) — the same value is already readable as text above it, so a
 * screen reader isn't made to parse a progress widget for a figure it just heard.
 *
 * Only publicly-visible MUNs get a link out; a DRAFT or REJECTED mun has no
 * public page, so linking one would be a guaranteed 404.
 */

const PUBLICLY_VISIBLE: readonly MunStatus[] = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "COMPLETED",
];

interface OrganizerMunCardProps {
  mun: OrganizerMunRow;
}

export function OrganizerMunCard({ mun }: OrganizerMunCardProps) {
  const location = [mun.city, mun.country].filter(Boolean).join(", ");
  const isPublic = PUBLICLY_VISIBLE.includes(mun.status);

  const hasCapacity = mun.capacity !== null && mun.capacity > 0;
  const fillPercent = hasCapacity
    ? Math.min(100, Math.round((mun.registrationCount / (mun.capacity as number)) * 100))
    : 0;

  return (
    <article className="flex flex-col gap-md rounded-md border border-border bg-card p-lg transition-colors duration-150 ease-out hover:border-border-strong">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h3 className="font-display text-title-sm text-balance text-ink">
            {mun.name}
            {mun.edition && (
              <span className="font-sans text-body-md font-normal text-muted-foreground">
                {" "}
                · {mun.edition}
              </span>
            )}
          </h3>
          <dl className="flex flex-wrap items-center gap-x-md gap-y-xxs text-body-md text-body dark:text-muted-foreground">
            <div className="flex items-center gap-xs">
              <dt className="sr-only">Location</dt>
              <MapPinIcon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-muted-foreground" />
              <dd className={cn(!location && "text-muted-foreground")}>
                {location || "Location TBA"}
              </dd>
            </div>
            <div className="flex items-center gap-xs">
              <dt className="sr-only">Dates</dt>
              <CalendarIcon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-muted-foreground" />
              <dd>{formatDateRange(mun.startDate, mun.endDate)}</dd>
            </div>
          </dl>
        </div>

        <MunStatusBadge status={mun.status} className="shrink-0" />
      </div>

      <div className="flex flex-col gap-xs border-t border-border pt-md">
        <div className="flex items-baseline justify-between gap-sm">
          <span className="flex items-center gap-xs text-body-md text-muted-foreground">
            <UsersIcon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
            Registrations
          </span>
          <span className="text-label-md tabular-nums text-ink">
            {mun.registrationCount.toLocaleString("en-IN")}
            {hasCapacity && (
              <span className="text-body-md font-normal text-muted-foreground">
                {" / "}
                {(mun.capacity as number).toLocaleString("en-IN")} seats
              </span>
            )}
          </span>
        </div>

        {hasCapacity ? (
          <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-strong dark:bg-muted">
            <div
              className="h-full rounded-pill bg-ink transition-[width] duration-300 ease-out dark:bg-foreground"
              style={{ width: `${Math.max(fillPercent, mun.registrationCount > 0 ? 2 : 0)}%` }}
            />
          </div>
        ) : (
          <p className="text-body-md text-muted-foreground">
            No registration products configured yet.
          </p>
        )}
      </div>

      {isPublic && (
        <Link
          href={`/mun/${mun.slug}`}
          className={cn(
            "group/link inline-flex w-fit items-center gap-xs rounded-sm text-body-md font-medium text-link outline-none",
            "transition-colors duration-150 ease-out hover:text-link-active",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          View public listing
          <ArrowUpRightIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-3.5 transition-transform duration-150 ease-out group-hover/link:translate-x-px group-hover/link:-translate-y-px"
          />
          <span className="sr-only"> for {mun.name}</span>
        </Link>
      )}
    </article>
  );
}
