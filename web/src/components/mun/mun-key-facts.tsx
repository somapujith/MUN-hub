import { useState, type ReactNode } from "react";
import {
  ArrowUpRightIcon,
  Building2Icon,
  CalendarDaysIcon,
  MapPinIcon,
  TicketIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { formatDateRange } from "@/components/shared/date-range";
import { formatDateTime, safeLinkUrl } from "@/components/mun/mun-format";
import { humanizeToken } from "@/lib/mun-public-labels";
import type { MunDetail } from "@/types";

/**
 * "Key facts" panel beside the MUN page body: dates, venue (+ map link),
 * registration window, organizer and format — the answers a delegate scans
 * for before reading anything else. `cream`-free, hairline card: the page's
 * signature surfaces are spent elsewhere.
 */

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-sm">
      <Icon aria-hidden strokeWidth={1.75} className="mt-[2px] size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-caption text-muted-foreground">{label}</dt>
        <dd className="mt-xxs text-body-md leading-relaxed text-ink">{children}</dd>
      </div>
    </div>
  );
}

function registrationSummary(mun: MunDetail, now: number): { headline: string; detail: string | null } {
  const opensAt = mun.registrationOpensAt;
  const deadline = mun.registrationDeadline;
  const deadlineLine = deadline
    ? `${deadline.getTime() < now ? "Closed" : "Closes"} ${formatDateTime(deadline)}`
    : null;

  switch (mun.status) {
    case "REGISTRATION_OPEN":
      return { headline: "Open now", detail: deadlineLine };
    case "PUBLISHED":
      return {
        headline:
          opensAt && opensAt.getTime() > now ? `Opens ${formatDateTime(opensAt)}` : "Not open yet",
        detail: deadline ? `Deadline ${formatDateTime(deadline)}` : null,
      };
    case "REGISTRATION_CLOSED":
      return { headline: "Closed", detail: deadline ? `Deadline was ${formatDateTime(deadline)}` : null };
    default:
      return { headline: "Closed", detail: null };
  }
}

export function MunKeyFacts({ mun }: { mun: MunDetail }) {
  const [now] = useState(() => Date.now());
  const registration = registrationSummary(mun, now);
  const mapUrl = safeLinkUrl(mun.mapUrl);

  const addressLines = [
    mun.venue,
    mun.addressLine1,
    [mun.city, mun.addressState, mun.postalCode].filter(Boolean).join(", "),
    mun.country,
  ].filter((line): line is string => Boolean(line && line.trim()));

  const committeeCount = mun.committees.length;
  const formatParts = [
    mun.conferenceType ? humanizeToken(mun.conferenceType) : null,
    mun.targetParticipantType ? `For ${humanizeToken(mun.targetParticipantType).toLowerCase()}` : null,
    committeeCount > 0 ? `${committeeCount} ${committeeCount === 1 ? "committee" : "committees"}` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="rounded-md border border-border bg-card p-lg">
      <h2 className="text-caption uppercase tracking-[0.16px] text-muted-foreground">Key facts</h2>
      <dl className="mt-md flex flex-col gap-md">
        <Fact icon={CalendarDaysIcon} label="Dates">
          {formatDateRange(mun.startDate, mun.endDate)}
        </Fact>

        <Fact icon={MapPinIcon} label="Venue">
          {addressLines.length > 0 ? (
            <span className="flex flex-col">
              {addressLines.map((line, index) => (
                <span key={index} className={index === 0 ? undefined : "text-body dark:text-muted-foreground"}>
                  {line}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">To be announced</span>
          )}
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-xxs inline-flex items-center gap-xxs rounded-sm text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open in maps
              <ArrowUpRightIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </Fact>

        <Fact icon={TicketIcon} label="Registration">
          <span className="block">{registration.headline}</span>
          {registration.detail && (
            <span className="block text-body dark:text-muted-foreground">{registration.detail}</span>
          )}
        </Fact>

        <Fact icon={Building2Icon} label="Organizer">
          {mun.organizerName ?? "Independent organizer"}
        </Fact>

        {formatParts.length > 0 && (
          <Fact icon={UsersIcon} label="Format">
            {formatParts.join(" · ")}
          </Fact>
        )}
      </dl>
    </div>
  );
}
