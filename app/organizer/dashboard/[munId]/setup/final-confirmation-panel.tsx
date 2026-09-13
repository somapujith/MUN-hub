"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircleIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { getStatusMeta, type MunStatus } from "@/lib/mun-status";
import { formatDateRange } from "@/components/shared/date-range";
import { formatPrice } from "@/components/shared/currency";
import { cn } from "cn";
import type { ConfirmationSummary } from "./confirmation-summary";
import { submitFinalConfirmationAction, type SubmitVerificationState } from "./actions";

/**
 * Gate 3 — Organizer Final Confirmation (PRD §14).
 *
 * Replaces the old `VerificationPanel` (deleted). That component's "Submit
 * for verification" button called `submitMunForVerification`, a status flip
 * with no summary and no confirmation record. This is the real gate: it
 * renders the complete submission (event info, committees, portfolios,
 * products) the organizer is about to lock in, requires them to tick the
 * PRD's exact confirmation statement, and only then calls
 * `submitFinalConfirmation`, which snapshots all of it.
 *
 * Same "explain, don't hide" rule as the old panel: outside CONTENT_SUBMITTED
 * this renders the mun's current status and a one-line explanation instead of
 * disappearing, using the same exhaustive `EXPLANATIONS` map so a future
 * MunStatus value is a compile error here, not a blank panel.
 */

const EXPLANATIONS: Record<MunStatus, string> = {
  DRAFT: "This conference hasn't been submitted for its initial review yet. Complete your application first.",
  SUBMITTED: "Your application is queued for its initial review by the MUN Hub team.",
  UNDER_REVIEW: "The MUN Hub team is reviewing your application. You'll be notified when there's a decision.",
  APPROVED: "Your application was approved. Onboarding starts next — content verification comes after that.",
  REJECTED: "This application was not approved, so it can't be submitted for confirmation.",
  CHANGES_REQUESTED: "The review team asked for changes. Address their notes and resubmit your application.",
  ONBOARDING:
    "You're in onboarding. Once your conference content is marked as submitted, you can confirm and submit it here.",
  CONTENT_SUBMITTED: "", // The one actionable state — copy lives in the panel body.
  ORGANIZER_CONFIRMATION:
    "You've confirmed this submission. MUN Hub verification starts next — you'll be notified of the outcome.",
  VERIFICATION: "Already confirmed — the review team is verifying your conference content now.",
  VERIFIED: "Your conference content passed verification. Publish it to make it live on the marketplace.",
  PUBLISHED: "This conference is live on the marketplace. Verification is complete.",
  REGISTRATION_OPEN: "Registration is open and delegates can sign up. Verification is complete.",
  REGISTRATION_CLOSED: "Registration has closed for this conference. Verification is complete.",
  CONFERENCE_ACTIVE: "The conference is running. Verification is complete.",
  RESULTS_PENDING: "The conference has ended — results haven't been submitted yet.",
  RESULTS_UNDER_REVIEW: "Results have been submitted and are under MUN Hub review.",
  COMPLETED: "This conference has finished. Verification is complete.",
  ARCHIVED: "This conference is archived and can no longer be edited or submitted.",
  CANCELLED: "This conference was cancelled and can no longer be edited or submitted.",
};

const SUBMITTABLE_STATUS: MunStatus = "CONTENT_SUBMITTED";
const EMPTY_STATE: SubmitVerificationState = { status: "idle" };

const CONFIRMATION_STATEMENT =
  "I confirm that the information displayed in this submission is accurate, complete and authorized for publication.";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : (
        <SendIcon aria-hidden strokeWidth={1.75} />
      )}
      {pending ? "Submitting…" : "Confirm and submit for verification"}
    </Button>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-md py-xs">
      <dt className="text-body-md text-muted-foreground">{label}</dt>
      <dd className="text-right text-body-md text-ink">{value}</dd>
    </div>
  );
}

export function FinalConfirmationPanel({
  munId,
  status,
  summary,
}: {
  munId: string;
  status: MunStatus;
  summary: ConfirmationSummary;
}) {
  const boundAction = React.useMemo(
    () => submitFinalConfirmationAction.bind(null, munId),
    [munId],
  );
  const [state, formAction] = useActionState<SubmitVerificationState, FormData>(
    boundAction,
    EMPTY_STATE,
  );
  const [acknowledged, setAcknowledged] = React.useState(false);

  const canSubmit = status === SUBMITTABLE_STATUS;
  const { label } = getStatusMeta(status);

  const lastToast = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (state.status === "idle" || !state.message) return;
    const signature = `${state.status}:${state.message}`;
    if (signature === lastToast.current) return;
    lastToast.current = signature;

    if (state.status === "error") toast.error(state.message);
    else toast.success(state.message);
  }, [state]);

  const { mun, committees, products } = summary;
  const activeProducts = products.filter((p) => p.status === "active");

  return (
    <section
      aria-labelledby="confirmation-heading"
      className={cn(
        "flex flex-col gap-lg rounded-md border p-lg",
        canSubmit
          ? "border-info/30 bg-info/5 dark:bg-info/10"
          : "border-border bg-surface-soft dark:bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h2 id="confirmation-heading" className="font-display text-title-sm text-ink">
            Final confirmation
          </h2>
          <p className="max-w-prose text-body-md text-pretty text-body dark:text-muted-foreground">
            {canSubmit
              ? "Review everything below. Confirming locks this submission and sends it to the review team — you'll be notified when it's verified or if changes are needed."
              : EXPLANATIONS[status]}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-xxs sm:items-end">
          <span className="text-body-md text-muted-foreground">Current status</span>
          <MunStatusBadge status={status} />
        </div>
      </div>

      {state.status === "error" && state.message && (
        <div
          role="alert"
          className="flex items-start gap-sm rounded-md border border-destructive/30 bg-destructive/10 p-md text-body-md text-destructive-text"
        >
          <TriangleAlertIcon aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0" />
          <p>{state.message}</p>
        </div>
      )}

      {canSubmit && (
        <>
          <div className="rounded-md border border-border bg-card p-md">
            <h3 className="text-title-sm text-ink">Event information</h3>
            <dl className="divide-y divide-border">
              <SummaryRow label="Name" value={mun.name} />
              {mun.edition && <SummaryRow label="Edition" value={mun.edition} />}
              {mun.theme && <SummaryRow label="Theme" value={mun.theme} />}
              <SummaryRow
                label="Dates"
                value={formatDateRange(mun.startDate, mun.endDate)}
              />
              <SummaryRow
                label="Location"
                value={[mun.venue, mun.city, mun.country].filter(Boolean).join(", ") || "Not set"}
              />
            </dl>
          </div>

          <div className="rounded-md border border-border bg-card p-md">
            <h3 className="text-title-sm text-ink">
              Committees &amp; portfolios ({committees.length})
            </h3>
            {committees.length === 0 ? (
              <p className="pt-xs text-body-md text-muted-foreground">No committees added yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {committees.map((committee) => (
                  <li key={committee.id} className="py-xs">
                    <div className="flex items-baseline justify-between gap-md">
                      <span className="text-body-md text-ink">{committee.name}</span>
                      <span className="text-body-md text-muted-foreground">
                        {committee.capacity} seats · {committee.portfolios.length} portfolios
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-border bg-card p-md">
            <h3 className="text-title-sm text-ink">
              Registration products ({activeProducts.length} active)
            </h3>
            {activeProducts.length === 0 ? (
              <p className="pt-xs text-body-md text-muted-foreground">
                No active registration products.
              </p>
            ) : (
              <dl className="divide-y divide-border">
                {activeProducts.map((product) => (
                  <SummaryRow
                    key={product.id}
                    label={product.name}
                    value={`${formatPrice(product.price)} · ${product.capacity} seats`}
                  />
                ))}
              </dl>
            )}
          </div>

          <form action={formAction} className="flex flex-col gap-md">
            <label className="flex items-start gap-sm text-body-md text-ink">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
                className="mt-px"
              />
              <span>{CONFIRMATION_STATEMENT}</span>
            </label>
            <div>
              <SubmitButton disabled={!acknowledged} />
            </div>
          </form>
        </>
      )}

      {!canSubmit && (
        <div className="flex flex-wrap items-center gap-sm">
          <Button type="button" variant="secondary" disabled className="disabled:opacity-100">
            <SendIcon aria-hidden strokeWidth={1.75} />
            Confirm and submit for verification
          </Button>
          <p className="text-body-md text-muted-foreground">
            Unavailable while this conference is {label.toLowerCase()}.
          </p>
        </div>
      )}
    </section>
  );
}
