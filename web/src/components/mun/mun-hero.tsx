import { Link } from "react-router";
import { CalendarDaysIcon, HourglassIcon, LockIcon, MapPinIcon, UsersIcon } from "lucide-react";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import { formatPrice } from "@/components/shared/currency";
import { Button } from "@/components/ui/button";
import { safeLinkUrl } from "@/components/mun/mun-format";
import { RemoteImage } from "@/components/mun/remote-image";
import {
  DEADLINE_URGENCY_WINDOW_DAYS,
  canRegisterForMun,
  daysUntilDeadline,
} from "@/components/registration/deadline";
import { cn } from "cn";
import type { MunDetail } from "@/types";

/**
 * MUN detail hero — `hero-band` (docs/prd/DESIGN-airtable.md § Cards & Containers).
 *
 * White canvas, no gradient, no mesh, no atmospheric backdrop: the doc is
 * explicit that the hero's strength is type + buttons sitting in whitespace
 * ("Don't add a gradient backdrop to the hero. Airtable's hero is white, full
 * stop."). Display type stays at weight 400 — emphasis comes from size, not
 * weight (doc Don't #3). One primary CTA per viewport (doc Do #2), paired with
 * the white outlined secondary.
 *
 * The organizer's cover photo, when there is one, sits above the type as a
 * cropped media well ({rounded.lg}) — never behind it — and the logo rides
 * next to the status badge.
 */

interface MunHeroProps {
  mun: MunDetail;
  /** Cheapest active registration product price, or null when none are active. */
  fromPrice: number | null;
}

export function MunHero({ mun, fromPrice }: MunHeroProps) {
  const canRegister = canRegisterForMun(mun);
  const location = [mun.venue, mun.city, mun.country].filter(Boolean).join(", ");
  const committeeCount = mun.committees.length;
  const cover = safeLinkUrl(mun.coverImage);
  const logo = safeLinkUrl(mun.logo);

  // Advance warning that the deadline is coming up — only while registration
  // is actually open, so this never contradicts the disabled/closed CTA
  // below (canRegister already folds in `!hasPassed`, so a stale
  // `daysUntilDeadline` reading can't show up alongside "Registration
  // closed").
  const daysLeft = canRegister ? daysUntilDeadline(mun.registrationDeadline) : null;
  const showDeadlineUrgency = daysLeft !== null && daysLeft <= DEADLINE_URGENCY_WINDOW_DAYS;
  const deadlineUrgencyLabel =
    daysLeft === 0
      ? "Registration closes today"
      : daysLeft === 1
        ? "Registration closes tomorrow"
        : `Registration closes in ${daysLeft} days`;

  return (
    <section className="border-b border-border bg-background">
      {cover && (
        <div className="content-container pt-lg">
          <RemoteImage
            src={cover}
            alt=""
            loading="eager"
            fetchPriority="high"
            className="aspect-[2/1] w-full rounded-lg bg-surface-soft object-cover sm:aspect-[3/1] lg:aspect-[4/1]"
          />
        </div>
      )}
      <div
        className={
          cover
            ? "content-container pt-xl pb-xl md:pt-xxl md:pb-xxl"
            : "content-container pt-xxl pb-xl md:pt-section md:pb-xxl"
        }
      >
        <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-xxl">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-sm">
              {logo && (
                <RemoteImage
                  src={logo}
                  alt={`${mun.name} logo`}
                  loading="eager"
                  className="size-12 rounded-md border border-border bg-white object-contain p-xxs"
                />
              )}
              <MunStatusBadge status={mun.status} audience="public" />
              {mun.edition && (
                <span className="text-caption text-muted-foreground">
                  Edition {mun.edition}
                </span>
              )}
            </div>

            {/* display-lg at 40px / weight 400 — never bold (doc Don't #3) */}
            <h1 className="mt-md font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink md:text-display-lg">
              {mun.name}
            </h1>

            {mun.theme && (
              <p className="mt-sm text-title-md font-normal text-body">{mun.theme}</p>
            )}

            {/* Supporting meta line: dates, location, scale. */}
            <dl className="mt-lg flex flex-wrap items-center gap-x-lg gap-y-xs text-body-md text-muted-foreground">
              <div className="flex items-center gap-xs">
                <dt className="sr-only">Dates</dt>
                <CalendarDaysIcon className="size-4 shrink-0" strokeWidth={1.75} />
                <dd>{formatDateRange(mun.startDate, mun.endDate)}</dd>
              </div>

              <div className="flex items-center gap-xs">
                <dt className="sr-only">Location</dt>
                <MapPinIcon className="size-4 shrink-0" strokeWidth={1.75} />
                <dd>{location || "Location to be announced"}</dd>
              </div>

              {committeeCount > 0 && (
                <div className="flex items-center gap-xs">
                  <dt className="sr-only">Committees</dt>
                  <UsersIcon className="size-4 shrink-0" strokeWidth={1.75} />
                  <dd>
                    {committeeCount} {committeeCount === 1 ? "committee" : "committees"}
                  </dd>
                </div>
              )}
            </dl>

            <p className="mt-xs text-body-md text-muted-foreground">
              Hosted by{" "}
              <span className="text-body">{mun.organizerName ?? "Independent organizer"}</span>
            </p>
          </div>

          {/* Action cluster: one primary CTA, one secondary — the doc's
              signature button pair. Price sits above it as plain meta, not as a
              pricing-dialect block (that lives in the registration section). */}
          <div className="flex flex-col gap-sm lg:items-end">
            {fromPrice !== null && (
              <p className="text-body-md text-muted-foreground lg:text-right">
                Registration from{" "}
                <span className="text-label-md text-ink tabular-nums">
                  {formatPrice(fromPrice)}
                </span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-sm">
              {canRegister ? (
                // `text-primary-foreground` is repeated here deliberately: the
                // variant's own color class is stripped by cn()/tailwind-merge,
                // which reads the custom `text-button` font-size token in the
                // size classes as a conflicting `text-*` color utility. Passing
                // it via className puts it last, so it survives the merge.
                // Without this the CTA renders #333840 on #181d26 (~1.3:1).
                <Button
                  className="text-primary-foreground"
                  render={<Link to={`/register/${mun.slug}`} />}
                >
                  Register now
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled
                  // Informational (non-interactive) disabled state: opacity-50
                  // fails contrast badly, so hold full opacity and let the
                  // hairline + icon carry the "unavailable" signal instead.
                  className="disabled:opacity-100 disabled:border-border-strong disabled:text-muted-foreground"
                >
                  <LockIcon className="size-4" strokeWidth={1.75} />
                  {mun.status === "REGISTRATION_CLOSED" ||
                  (mun.status === "REGISTRATION_OPEN" && !canRegister)
                    ? "Registration closed"
                    : "Registration not open yet"}
                </Button>
              )}

              <Button variant="outline" render={<a href="#registration" />}>
                View passes
              </Button>
            </div>

            {showDeadlineUrgency && (
              <p
                role="status"
                className={cn(
                  "inline-flex items-center gap-xs text-body-md",
                  daysLeft !== null && daysLeft <= 2 ? "text-destructive-text" : "text-warning-text",
                )}
              >
                <HourglassIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {deadlineUrgencyLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
