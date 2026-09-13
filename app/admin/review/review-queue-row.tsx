import {
  BuildingIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  ExternalLinkIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { formatDateRange } from "@/components/shared/date-range";
import type { MunWithApplication } from "@/lib/types";
import { ReviewDecisionDialog } from "./review-decision-dialog";
import { PublishButton } from "./publish-button";
import { ReinstateMunButton, SuspendMunButton, UnpublishButton } from "./mun-lifecycle-buttons";

/** Absolute + relative submitted-at, because ops scan for staleness first. */
function formatSubmitted(date: Date): string {
  const absolute = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return `${absolute} · today`;
  if (days === 1) return `${absolute} · 1 day ago`;
  return `${absolute} · ${days} days ago`;
}

function MetaItem({
  icon: Icon,
  children,
}: {
  icon: typeof MapPinIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-body-md text-muted-foreground">
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {children}
    </span>
  );
}

/**
 * One queue row. Server component — the only client boundaries are the
 * decision dialogs, so 99 pending rows don't ship 99 copies of the queue's
 * markup as client JS.
 *
 * Available actions are derived from the lifecycle in
 * `lib/lifecycle/mun-state-machine.ts`, not guessed: a decision
 * (APPROVED/REJECTED/CHANGES_REQUESTED) is only legal from UNDER_REVIEW, and
 * `reviewMunApplication` auto-claims a SUBMITTED mun into UNDER_REVIEW first —
 * so both queue statuses get the same three buttons. Publish/unpublish/
 * suspend/reinstate are gated the same way against `ALLOWED_TRANSITIONS`
 * (PUBLISHED -> VERIFIED, PUBLISHED/REGISTRATION_OPEN/... -> SUSPENDED,
 * SUSPENDED -> VERIFICATION) — note `getReviewQueue` currently only queries
 * SUBMITTED/UNDER_REVIEW, so in practice only the decide buttons render from
 * today's default query; these flags exist so the row renders correctly the
 * moment that query (or a future "all muns" admin view reusing this same
 * row) surfaces a mun in one of these later-lifecycle statuses.
 */
export function ReviewQueueRow({ mun }: { mun: MunWithApplication }) {
  const application = mun.organizerApplication;
  const canDecide = mun.status === "SUBMITTED" || mun.status === "UNDER_REVIEW";
  const canPublish = mun.status === "VERIFICATION";
  const canUnpublish = mun.status === "PUBLISHED";
  const canSuspend =
    mun.status === "PUBLISHED" ||
    mun.status === "REGISTRATION_OPEN" ||
    mun.status === "REGISTRATION_CLOSED" ||
    mun.status === "CONFERENCE_ACTIVE";
  const canReinstate = mun.status === "SUSPENDED";
  const logs = mun.verificationLogs;
  const submittedAt = application?.submittedAt ?? mun.createdAt;

  return (
    <Card
      size="sm"
      className="gap-sm transition-colors hover:border-border-strong focus-within:border-border-strong"
    >
      <CardContent className="flex flex-col gap-sm">
        {/* headline row: name + status */}
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-xs">
              <h3 className="truncate font-display text-title-sm font-medium text-ink">
                {mun.name}
              </h3>
              <MunStatusBadge status={mun.status} />
              {application && application.status !== "SUBMITTED" && (
                <Badge variant="outline" className="font-mono text-[11px]">
                  application {application.status.toLowerCase().replace("_", " ")}
                </Badge>
              )}
            </div>
            <span className="truncate font-mono text-[12px] text-muted-foreground">
              /{mun.slug}
            </span>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-xs">
            {canDecide && (
              <>
                <ReviewDecisionDialog
                  munId={mun.id}
                  munName={mun.name}
                  decision="APPROVED"
                />
                <ReviewDecisionDialog
                  munId={mun.id}
                  munName={mun.name}
                  decision="CHANGES_REQUESTED"
                />
                <ReviewDecisionDialog
                  munId={mun.id}
                  munName={mun.name}
                  decision="REJECTED"
                />
              </>
            )}
            {canPublish && <PublishButton munId={mun.id} munName={mun.name} />}
            {canUnpublish && <UnpublishButton munId={mun.id} munName={mun.name} />}
            {canSuspend && <SuspendMunButton munId={mun.id} munName={mun.name} />}
            {canReinstate && <ReinstateMunButton munId={mun.id} munName={mun.name} />}
          </div>
        </div>

        {/* meta strip */}
        <div className="flex flex-wrap items-center gap-x-lg gap-y-xs">
          <MetaItem icon={ClockIcon}>Submitted {formatSubmitted(submittedAt)}</MetaItem>
          <MetaItem icon={CalendarIcon}>{formatDateRange(mun.startDate, mun.endDate)}</MetaItem>
          <MetaItem icon={MapPinIcon}>
            {[mun.city, mun.country].filter(Boolean).join(", ") || "Location TBA"}
          </MetaItem>
          <MetaItem icon={BuildingIcon}>
            <span className="font-mono text-[12px]">organizer {mun.organizerId.slice(0, 8)}</span>
          </MetaItem>
        </div>

        {/* inline expand — native <details>, no client JS for 99 rows */}
        <details className="group/details -mx-xs">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm px-xs py-1 text-body-md font-medium text-ink transition-colors outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="size-3.5 transition-transform duration-150 group-open/details:rotate-90"
              strokeWidth={1.75}
              aria-hidden
            />
            Application detail
            {logs.length > 0 && (
              <span className="text-muted-foreground">({logs.length} log entries)</span>
            )}
          </summary>

          <div className="mt-sm flex flex-col gap-md rounded-md bg-surface-soft p-md">
            <div className="flex flex-col gap-xxs">
              <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                Proposal
              </span>
              <p className="text-body-md whitespace-pre-line text-body">
                {mun.description?.trim() || "No description submitted."}
              </p>
            </div>

            {mun.theme && (
              <div className="flex flex-col gap-xxs">
                <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                  Theme
                </span>
                <p className="text-body-md text-body">{mun.theme}</p>
              </div>
            )}

            {mun.venue && (
              <div className="flex flex-col gap-xxs">
                <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                  Venue
                </span>
                <p className="text-body-md text-body">{mun.venue}</p>
              </div>
            )}

            {application?.reviewNotes && (
              <div className="flex flex-col gap-xxs">
                <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                  Previous review notes
                </span>
                <p className="text-body-md whitespace-pre-line text-body">
                  {application.reviewNotes}
                </p>
              </div>
            )}

            {!application && (
              <p className="text-body-md text-warning-text">
                No linked organizer application row — this MUN was created outside the application
                flow.
              </p>
            )}

            <div className="flex flex-col gap-xs">
              <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                Verification log
              </span>
              {logs.length === 0 ? (
                <p className="text-body-md text-muted-foreground">
                  No transitions recorded yet.
                </p>
              ) : (
                <ol className="flex flex-col gap-xs border-l border-border pl-sm">
                  {logs.map((log) => (
                    <li key={log.id} className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-xs">
                        <span className="font-mono text-[12px] font-medium text-ink">
                          {log.action}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {new Intl.DateTimeFormat("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(log.createdAt)}
                          {" · reviewer "}
                          {log.reviewerId.slice(0, 8)}
                        </span>
                      </div>
                      {log.notes && (
                        <p className="text-body-md text-body">
                          <span className="text-muted-foreground">To organizer: </span>
                          {log.notes}
                        </p>
                      )}
                      {log.internalNotes && (
                        <p className="text-body-md text-body">
                          <span className="text-muted-foreground">Internal: </span>
                          {log.internalNotes}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <Link
              href={`/mun/${mun.slug}`}
              className="inline-flex w-fit items-center gap-1.5 text-body-md text-link underline-offset-4 hover:underline"
            >
              Preview public page
              <ExternalLinkIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
            </Link>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
