import Link from "next/link";
import {
  CalendarClockIcon,
  ExternalLinkIcon,
  MapPinIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import { munSectionHref } from "@/app/organizer/dashboard/nav-config";
import {
  daysUntil,
  hasPublicPage,
  type OrganizerMunSummary,
} from "@/app/organizer/dashboard/(workspace)/workspace-data";
import { cn } from "cn";

/**
 * One conference on My MUNs (PRD § 7).
 *
 * PRD § 7's card lists nine things; this renders the seven that are backed by
 * real columns — name, edition, date, location, status, registrations,
 * registration deadline — and skips GMV, because no organizer-wide payment
 * aggregate exists and a wrong rupee figure on a dashboard is worse than none.
 * Of the six listed actions only "Manage" and "View live page" exist:
 * Duplicate and Archive have no server action behind them, and Edit / Preview
 * are both reachable from inside Manage rather than as a third and fourth
 * button competing with it here.
 *
 * The whole card is one link target via a stretched-link overlay on the title,
 * so the click area is the card (a 1-line "Manage" button is a small target on
 * touch) — while the real anchors stay real anchors for keyboard and
 * middle-click. The "View live page" button sits above that overlay in the
 * stacking order so it stays independently clickable.
 */

interface OrganizerMunCardProps {
  mun: OrganizerMunSummary;
  /** Injected so a list of cards agrees on "now" across every countdown. */
  now: Date;
}

export function OrganizerMunCard({ mun, now }: OrganizerMunCardProps) {
  const manageHref = munSectionHref(mun.id, "setup");
  const location = [mun.city, mun.country].filter(Boolean).join(", ");
  const isPublic = hasPublicPage(mun.status);

  return (
    <article
      className={cn(
        "group/mun relative isolate flex w-full flex-1 flex-col gap-md rounded-md border border-border bg-card p-md",
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "hover:border-border-strong focus-within:border-border-strong",
        "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background",
      )}
    >
      <header className="flex flex-col gap-xs">
        <div className="flex flex-wrap items-start justify-between gap-xs">
          <h3 className="font-display text-title-sm text-balance text-ink">
            {/* Stretched link: the accessible name is the MUN name, the hit
                area is the card. `before:` sits at z-0 under the action row. */}
            <Link
              href={manageHref}
              className="outline-none before:absolute before:inset-0 before:z-0 before:rounded-md"
            >
              {mun.name}
            </Link>
          </h3>
          <MunStatusBadge status={mun.status} />
        </div>

        {/* Edition + dates on one line, location on its own. Separators are
            emitted BETWEEN items rather than after each one — appending a
            trailing `·` and hiding it with CSS leaves a dangling dot the
            moment the line wraps, which is exactly what a 2-up card grid
            does at every breakpoint. */}
        <p className="flex flex-wrap items-center gap-x-xs gap-y-xxs text-body-md text-muted-foreground">
          {mun.edition && (
            <>
              <span className="tabular-nums">Edition {mun.edition}</span>
              <Dot />
            </>
          )}
          <span className="tabular-nums">
            {formatDateRange(mun.startDate, mun.endDate)}
          </span>
        </p>

        <p className="flex items-center gap-xxs text-body-md text-muted-foreground">
          <MapPinIcon
            aria-hidden
            strokeWidth={1.75}
            className="size-3.5 shrink-0"
          />
          {location || "Location not set"}
        </p>
      </header>

      <dl className="flex flex-wrap gap-x-lg gap-y-xs">
        <Field
          icon={UsersIcon}
          label="Registrations"
          value={
            <>
              <span className="tabular-nums">
                {mun.confirmed.toLocaleString("en-IN")}
              </span>
              {mun.capacity !== null && (
                <span className="text-muted-foreground">
                  {" / "}
                  <span className="tabular-nums">
                    {mun.capacity.toLocaleString("en-IN")}
                  </span>
                </span>
              )}
            </>
          }
          hint={
            mun.pending > 0
              ? `${mun.pending.toLocaleString("en-IN")} awaiting payment`
              : undefined
          }
        />
        <Field
          icon={CalendarClockIcon}
          label="Registration deadline"
          value={<DeadlineValue deadline={mun.registrationDeadline} now={now} />}
        />
      </dl>

      {/* z-10 lifts the action row above the stretched-link overlay so these
          are separately clickable rather than swallowed by the card link. */}
      <div className="z-10 mt-auto flex flex-wrap items-center gap-xs">
        <Button size="sm" variant="outline" render={<Link href={manageHref} />}>
          <SettingsIcon aria-hidden strokeWidth={1.75} />
          Manage
          <span className="sr-only"> {mun.name}</span>
        </Button>
        {isPublic && (
          <Button
            size="sm"
            variant="ghost"
            render={
              <Link href={`/mun/${mun.slug}`} target="_blank" rel="noreferrer" />
            }
          >
            <ExternalLinkIcon aria-hidden strokeWidth={1.75} />
            View live page
            <span className="sr-only"> for {mun.name} (opens in a new tab)</span>
          </Button>
        )}
      </div>
    </article>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof UsersIcon;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-xxs">
      <dt className="flex items-center gap-xxs text-body-md text-muted-foreground">
        <Icon aria-hidden strokeWidth={1.75} className="size-3.5" />
        {label}
      </dt>
      <dd className="text-label-md text-ink">
        {value}
        {hint && (
          <span className="ml-xs align-middle text-body-md text-muted-foreground">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * The deadline cell. Three real states — no deadline configured, already
 * passed, still ahead — because `registrationProducts.deadline` is nullable
 * and every seeded product currently leaves it null. Rendering an em dash for
 * "not set" is honest; inventing a date is not.
 */
function DeadlineValue({ deadline, now }: { deadline: Date | null; now: Date }) {
  if (!deadline) {
    return (
      <span className="text-muted-foreground">
        Not set
        <span className="sr-only"> — no registration deadline configured</span>
      </span>
    );
  }

  const days = daysUntil(deadline, now);
  const formatted = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(deadline);

  return (
    <span className="tabular-nums">
      {formatted}
      <span
        className={cn(
          "ml-xs align-middle text-body-md",
          days < 0
            ? "text-muted-foreground"
            : days <= 7
              ? "text-warning-text"
              : "text-muted-foreground",
        )}
      >
        {days < 0
          ? "closed"
          : days === 0
            ? "closes today"
            : `${days} ${days === 1 ? "day" : "days"} left`}
      </span>
    </span>
  );
}
