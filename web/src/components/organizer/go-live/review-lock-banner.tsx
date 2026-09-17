import { LockIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import {
  AWAITING_CONFIRMATION_STATUSES,
  EDITABLE_DURING_REVIEW_SEGMENTS,
  isUnderReview,
} from "@/lib/organizer/go-live";
import { munSectionHref, parseOrganizerDashboardPath } from "@/lib/organizer/nav-config";
import type { WorkspaceMun } from "@/types/organizer";

const LOCKED_TEXT =
  "Details, committees, registration products, documents, schedule, contact and payment details can't be changed until the review is finished. Your logo, cover image and registration form stay editable.";

/**
 * Shown above every MUN section while the MUN is in review. Sections backed
 * by high-impact modules refuse organizer edits until the review ends, so
 * this explains the refusal before the organizer hits it.
 */
export function ReviewLockBanner({ mun }: { mun: WorkspaceMun }) {
  const { pathname } = useLocation();
  if (!isUnderReview(mun.status)) return null;

  const { section } = parseOrganizerDashboardPath(pathname);
  const onSetup = section === "setup";
  const editableHere = section !== null && EDITABLE_DURING_REVIEW_SEGMENTS.includes(section);
  const awaitingConfirmation = AWAITING_CONFIRMATION_STATUSES.includes(mun.status);

  const title = awaitingConfirmation
    ? `${mun.name} is waiting for your confirmation`
    : `MUN Hub is reviewing ${mun.name}`;
  const body = editableHere
    ? "You can keep editing this section during the review."
    : awaitingConfirmation
      ? `Your MUN passed the automated checks. ${LOCKED_TEXT} Confirm your submission to send it to MUN Hub.`
      : `${LOCKED_TEXT} Any section a reviewer sends back unlocks for you.`;

  return (
    <div
      role="status"
      data-testid="review-lock-banner"
      className="mx-md mt-md flex flex-wrap items-start gap-sm rounded-md border border-warning/40 bg-warning/10 px-md py-sm text-body-md text-warning-text sm:mx-lg"
    >
      <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-xxs">
        <p className="font-medium">{title}</p>
        <p>{body}</p>
      </div>
      {!onSetup && (
        <Link to={munSectionHref(mun.id, "setup")} className="shrink-0 font-medium underline underline-offset-2">
          {awaitingConfirmation ? "Confirm submission" : "See review status"}
        </Link>
      )}
    </div>
  );
}
