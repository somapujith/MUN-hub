import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, HourglassIcon } from "lucide-react";
import { getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";

/**
 * Workspace-wide (not per-MUN) payout status banner, shown above every
 * organizer page via `WorkspaceShell`. Reads the same
 * `GET /organizer/onboarding` the wizard and Quick Setup use, keyed by
 * `queryKeys.organizerOnboarding()` so this shares one cache entry with those
 * call sites rather than firing a second request.
 *
 * Yellow while the organizer has finished onboarding (their Gate-1
 * application is submitted) but staff haven't verified their payout details
 * yet. Green once staff verify it — at that point the organizer can publish
 * their own MUN with no further admin involvement (see the "Go live" action
 * on MUN Setup). Shows nothing before onboarding finishes, or while loading.
 */
export function PayoutStatusBanner() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.organizerOnboarding(),
    queryFn: getOrganizerOnboarding,
  });

  if (isLoading || !data || !data.completed) return null;

  if (data.profile.payoutVerified) {
    return (
      <div
        role="status"
        data-testid="payout-status-banner"
        className="mx-md mt-md flex flex-wrap items-start gap-sm rounded-md border border-success/40 bg-success/10 px-md py-sm text-body-md text-success-text sm:mx-lg"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-medium">Payment verification is complete.</span> Your MUN is ready to be hosted —
          publish it yourself from MUN Setup whenever you're ready.
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="payout-status-banner"
      className="mx-md mt-md flex flex-wrap items-start gap-sm rounded-md border border-warning/40 bg-warning/10 px-md py-sm text-body-md text-warning-text sm:mx-lg"
    >
      <HourglassIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">Your payment confirmation is awaiting verification.</span> Your conference
        will go live once it's verified.
      </p>
    </div>
  );
}
