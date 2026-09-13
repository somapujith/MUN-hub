"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircleIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { getStatusMeta, type MunStatus } from "@/lib/mun-status";
import { cn } from "cn";
import {
  submitForVerificationAction,
  type SubmitVerificationState,
} from "./actions";

/**
 * "Submit for verification" — the one lifecycle action this module owns.
 *
 * THE STATUS RULE
 * ---------------
 * ⚠️ STALE as of the verification/confirmation trust layer (2026-09-13,
 * see docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md):
 * `ALLOWED_TRANSITIONS` in `lib/lifecycle/mun-state-machine.ts` now reads
 * `CONTENT_SUBMITTED: ['ORGANIZER_CONFIRMATION']`, not `['VERIFICATION']` —
 * a new gate (organizer final confirmation, `submitFinalConfirmation` in
 * `lib/lifecycle/organizer-confirmation.ts`) sits between them. This panel's
 * "Submit for verification" action likely needs to become "Submit final
 * confirmation" and call the new action instead once that lands (Task 4 of
 * the linked plan). Left as-is for now so this file still compiles; whoever
 * picks up the Organizer Final Confirmation screen should replace this
 * component's behavior, not just its copy.
 *
 * WHY EXPLAIN INSTEAD OF HIDE
 * ---------------------------
 * A submit button that simply isn't rendered leaves the organizer to guess
 * whether they already submitted, whether the feature exists, or whether
 * something is broken. Since the lifecycle is 15 states deep and mostly driven
 * by other people (admins reviewing, the platform publishing), the honest UI is
 * "here is where you are, here is why you can't act, here is what happens
 * next". `EXPLANATIONS` below is that mapping, and it is exhaustive over
 * `MunStatus` — the `Record` type makes a new enum member a compile error here
 * rather than a silently blank panel.
 *
 * The disabled button uses `variant="secondary"` with `disabled:opacity-100`
 * rather than the default disabled dimming: at 50% opacity, informational
 * (non-interactive) disabled text fails contrast, which was already caught and
 * fixed once on the registration cards.
 */

/** What the organizer should understand from each status they might land on. */
const EXPLANATIONS: Record<MunStatus, string> = {
  DRAFT:
    "This conference hasn't been submitted for its initial review yet. Complete your application first.",
  SUBMITTED: "Your application is queued for its initial review by the MUN Hub team.",
  UNDER_REVIEW:
    "The MUN Hub team is reviewing your application. You'll be notified when there's a decision.",
  APPROVED:
    "Your application was approved. Onboarding starts next — content verification comes after that.",
  REJECTED:
    "This application was not approved, so it can't be submitted for verification.",
  CHANGES_REQUESTED:
    "The review team asked for changes. Address their notes and resubmit your application.",
  ONBOARDING:
    "You're in onboarding. Once your conference content is marked as submitted, you can send it for verification here.",
  CONTENT_SUBMITTED: "", // The one actionable state — copy lives in the panel body.
  // TODO(mun-hub-02): placeholder copy — added mechanically from lib/ to
  // unblock tsc after MunStatus gained 5 new values for the verification/
  // confirmation trust layer (see docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md).
  // Please replace with real product copy matching this panel's voice.
  ORGANIZER_CONFIRMATION:
    "Waiting on your final confirmation of the submitted details before MUN Hub review begins.",
  VERIFICATION:
    "Already submitted — the review team is verifying your conference content now.",
  VERIFIED:
    "Your conference content passed verification. Publish it to make it live on the marketplace.",
  PUBLISHED:
    "This conference is live on the marketplace. Verification is complete.",
  REGISTRATION_OPEN:
    "Registration is open and delegates can sign up. Verification is complete.",
  REGISTRATION_CLOSED:
    "Registration has closed for this conference. Verification is complete.",
  CONFERENCE_ACTIVE: "The conference is running. Verification is complete.",
  RESULTS_PENDING: "The conference has ended — results haven't been submitted yet.",
  RESULTS_UNDER_REVIEW: "Results have been submitted and are under MUN Hub review.",
  COMPLETED: "This conference has finished. Verification is complete.",
  ARCHIVED: "This conference is archived and can no longer be edited or submitted.",
  CANCELLED: "This conference was cancelled and can no longer be edited or submitted.",
};

/** The single status from which `submitMunForVerification` is a legal call. */
const SUBMITTABLE_STATUS: MunStatus = "CONTENT_SUBMITTED";

const EMPTY_STATE: SubmitVerificationState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : (
        <SendIcon aria-hidden strokeWidth={1.75} />
      )}
      {pending ? "Submitting…" : "Submit for verification"}
    </Button>
  );
}

export function VerificationPanel({
  munId,
  status,
}: {
  munId: string;
  status: MunStatus;
}) {
  const boundAction = React.useMemo(
    () => submitForVerificationAction.bind(null, munId),
    [munId],
  );
  const [state, formAction] = useActionState<SubmitVerificationState, FormData>(
    boundAction,
    EMPTY_STATE,
  );

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

  return (
    <section
      aria-labelledby="verification-heading"
      className={cn(
        "flex flex-col gap-md rounded-md border p-lg",
        canSubmit
          ? "border-info/30 bg-info/5 dark:bg-info/10"
          : "border-border bg-surface-soft dark:bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h2
            id="verification-heading"
            className="font-display text-title-sm text-ink"
          >
            Verification
          </h2>
          <p className="max-w-prose text-body-md text-pretty text-body dark:text-muted-foreground">
            {canSubmit
              ? "Your conference content is ready to review. Submitting locks it for the review team — you'll be notified when they've verified it or asked for changes."
              : EXPLANATIONS[status]}
          </p>
        </div>
        {/* Left-aligned in the stacked (mobile) layout, right-aligned once it
            sits beside the heading — an end-aligned label floating mid-column
            under a left-aligned paragraph reads as a stray fragment. */}
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
          <TriangleAlertIcon
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-4 shrink-0"
          />
          <p>{state.message}</p>
        </div>
      )}

      {canSubmit ? (
        <form action={formAction} className="flex justify-start">
          <SubmitButton />
        </form>
      ) : (
        // Rendered rather than hidden so the action's existence and its
        // precondition are both visible. `disabled:opacity-100` keeps the
        // label legible — this is informational, not a dimmed live control.
        <div className="flex flex-wrap items-center gap-sm">
          <Button
            type="button"
            variant="secondary"
            disabled
            className="disabled:opacity-100"
          >
            <SendIcon aria-hidden strokeWidth={1.75} />
            Submit for verification
          </Button>
          <p className="text-body-md text-muted-foreground">
            Unavailable while this conference is {label.toLowerCase()}.
          </p>
        </div>
      )}
    </section>
  );
}
