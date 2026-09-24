import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { IndianRupee, ReceiptIndianRupee } from "lucide-react";
import { Link, useParams } from "react-router";
import { getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { getPaymentsSummary } from "@/api/payment-settlement";
import { queryKeys } from "@/api/query-keys";
import { formatPrice } from "@/components/shared/currency";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What delegates have paid for this MUN and what the organizer is owed,
 * backed by `getMunPaymentsSummary` (lib/actions/payment-settlement.ts) —
 * computed but never surfaced anywhere in the organizer web app until now.
 * One entry per currency (in practice always INR); an empty list means
 * nothing has been paid yet. The fee model is additive (docs/payments/
 * CASHFREE.md, lib/payments/fees-additive.ts): a delegate pays the listed
 * price plus MUN Hub's platform fee plus GST on that fee, and the organizer
 * receives the full listed price back as `organizerNet`.
 */
function PaymentsSummarySection({ munId }: { munId: string }) {
  const summaryQuery = useQuery({
    queryKey: queryKeys.paymentsSummary(munId),
    queryFn: () => getPaymentsSummary(munId),
    enabled: Boolean(munId),
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (summaryQuery.isError) {
    return <p className="text-body-md text-destructive">{summaryQuery.error.message}</p>;
  }

  const totals = summaryQuery.data ?? [];

  if (totals.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
        <ReceiptIndianRupee className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h3 className="mt-md font-display text-title-sm text-ink">No payments yet</h3>
        <p className="mt-xs text-body-md text-muted-foreground">
          Once delegates start paying for registration, what you&apos;ve collected and what you&apos;re owed will
          show up here.
        </p>
      </div>
    );
  }

  return (
    <>
      {totals.map((summary) => {
        const totalFee = summary.platformFee + summary.platformFeeTax;
        return (
          <section
            key={summary.currency}
            aria-label={`Payments in ${summary.currency}`}
            className="flex flex-col gap-sm"
          >
            <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
              {[
                { label: "Collected", value: formatPrice(summary.grossCollected) },
                { label: "MUN Hub fee (incl. GST)", value: formatPrice(totalFee) },
                { label: "Net to you", value: formatPrice(summary.organizerNet) },
                { label: "Paid registrations", value: summary.paidRegistrations.toLocaleString("en-IN") },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-border bg-card p-md">
                  <p className="text-body-md text-muted-foreground">{stat.label}</p>
                  <p className="font-display text-title-lg tabular-nums text-ink">{stat.value}</p>
                </div>
              ))}
            </div>
            <dl className="grid gap-md rounded-md border border-border bg-card p-md sm:grid-cols-2">
              <div className="flex flex-col gap-xxs">
                <dt className="text-caption text-muted-foreground">Platform fee</dt>
                <dd className="text-body-md tabular-nums text-ink">{formatPrice(summary.platformFee)}</dd>
              </div>
              <div className="flex flex-col gap-xxs">
                <dt className="text-caption text-muted-foreground">GST on platform fee</dt>
                <dd className="text-body-md tabular-nums text-ink">{formatPrice(summary.platformFeeTax)}</dd>
              </div>
            </dl>
          </section>
        );
      })}
      <p className="text-caption text-muted-foreground">
        Collected is what delegates paid for seats that still stand, including MUN Hub&apos;s platform fee and the
        GST on it; net to you is what remains after them. This does not include the price paid by delegates whose
        registration was later cancelled or refunded.
      </p>
    </>
  );
}

/**
 * Read-only payout destination, cross-referencing the UPI details organizers
 * set once during onboarding (`lib/actions/organizer-onboarding.ts`) — the
 * same data `PaymentDetailsCard` on the Settings page reads, so the two
 * never disagree. Editing stays on Settings; this only links there.
 */
function PayoutDestinationCard({ munId }: { munId: string }) {
  const onboardingQuery = useQuery({
    queryKey: queryKeys.organizerOnboarding(),
    queryFn: getOrganizerOnboarding,
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Payout destination</CardTitle>
        <CardDescription>Where MUN Hub sends your net payout once this conference is settled.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        {onboardingQuery.isLoading ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : onboardingQuery.isError ? (
          <p className="text-body-md text-destructive">{onboardingQuery.error.message}</p>
        ) : onboardingQuery.data?.profile.upiId ? (
          <div className="flex flex-col gap-xxs rounded-md border border-border bg-card px-md py-sm">
            <p className="text-body-md text-ink">
              <span className="font-medium">UPI ID:</span> {onboardingQuery.data.profile.upiId}
            </p>
            {onboardingQuery.data.profile.upiPhone && (
              <p className="text-body-md text-muted-foreground">
                Linked mobile: {onboardingQuery.data.profile.upiPhone}
              </p>
            )}
          </div>
        ) : (
          <p className="text-body-md text-muted-foreground">No payout details on file yet.</p>
        )}
        <p className="text-body-md text-muted-foreground">
          <Link
            to={`/organizer/dashboard/${munId}/settings`}
            className="text-link underline-offset-4 hover:underline"
          >
            Manage payout details in Settings
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export function OrganizerPaymentsPage() {
  const { munId = "" } = useParams();

  return (
    <>
      <Helmet title="Payments" />
      <WorkspacePage
        title="Payments"
        description="What delegates have paid for this conference, MUN Hub's platform fee, and what you're owed."
        actions={<IndianRupee aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.75} />}
      >
        <PaymentsSummarySection munId={munId} />
        <PayoutDestinationCard munId={munId} />
      </WorkspacePage>
    </>
  );
}
