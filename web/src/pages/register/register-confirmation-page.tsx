import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { formatDateRange } from "@/components/shared/date-range";
import { formatPrice } from "@/components/shared/currency";
import { queryKeys } from "@/api/query-keys";
import { fetchRegistrationById } from "@/api/registration";
import { NotFoundPage } from "@/pages/not-found-page";
import type { PaymentStatus, RegistrationStatus } from "@/types/enums";

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: "Awaiting payment",
  PAYMENT_PENDING: "Payment in progress",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  REFUNDED: "Payment exception",
  ATTENDED: "Attended",
  NO_SHOW: "Marked as no-show",
};

export function RegisterConfirmationPage() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get("registrationId");
  const navigate = useNavigate();

  const regQuery = useQuery({
    queryKey: queryKeys.registration(registrationId ?? ""),
    queryFn: () => fetchRegistrationById(registrationId!),
    enabled: Boolean(registrationId),
  });
  const registration = regQuery.data;

  useEffect(() => {
    if (!registrationId) navigate(`/register/${slug}`, { replace: true });
  }, [registrationId, slug, navigate]);

  if (!registrationId) return null;

  if (regQuery.isPending) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-lg py-xxl" aria-busy="true" />
        <SiteFooter />
      </div>
    );
  }
  if (!registration) return <NotFoundPage />;

  const mun = registration.mun;
  // What was actually charged (early-bird and extras included). No payment
  // row means a free pass.
  const payment = registration.payment.at(0);
  const receipt = (
    <dl className="divide-y divide-border rounded-md border border-border bg-card">
      <ReceiptRow label="Reference" value={registration.id} mono />
      <ReceiptRow label="Conference" value={mun.name} />
      <ReceiptRow label="Dates" value={formatDateRange(mun.startDate, mun.endDate)} />
      <ReceiptRow label="Pass" value={registration.productName} />
      {registration.committee && <ReceiptRow label="Committee" value={registration.committee.name} />}
      {registration.portfolio && <ReceiptRow label="Portfolio" value={registration.portfolio.name} />}
      <ReceiptRow label="Amount" value={payment ? formatPrice(payment.amount) : "Free"} mono />
      <ReceiptRow label="Status" value={STATUS_LABEL[registration.status]} />
    </dl>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet><title>Registration status | MUN Hub</title></Helmet>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        {renderStatus(registration.status, slug, receipt, registrationId, payment?.status)}
      </main>
      <SiteFooter />
    </div>
  );
}

function renderStatus(
  status: RegistrationStatus,
  slug: string,
  receipt: ReactNode,
  registrationId: string,
  /** Undefined when the pass was free (no payment row). */
  paymentStatus: PaymentStatus | undefined,
) {
  switch (status) {
    case "CONFIRMED":
      return (
        <RegistrationNotice
          tone="success"
          title="You're registered"
          message={
            paymentStatus
              ? "Payment went through and your seat is confirmed. Your pass carries the check-in code you show at the registration desk."
              : "Your seat is confirmed. Your pass carries the check-in code you show at the registration desk."
          }
          detail={receipt}
        >
          <Button render={<Link to={`/dashboard/registrations/${encodeURIComponent(registrationId)}/pass`} />}>
            View your pass
          </Button>
          <Button
            variant="outline"
            render={<Link to={`/dashboard/registrations/${encodeURIComponent(registrationId)}/receipt`} />}
          >
            View receipt
          </Button>
          <Button variant="outline" render={<Link to="/dashboard" />}>
            Your registrations
          </Button>
        </RegistrationNotice>
      );
    case "CANCELLED":
      // A cancelled registration can mean three different things for the
      // delegate's money; never say "didn't go through" when it did.
      // Money taken after the seat hold ended (PAID with an exception, or a
      // legacy REFUNDED row) is returned by staff by hand — there are no
      // automatic refunds — so paying again would charge the delegate twice.
      if (paymentStatus === "PAID" || paymentStatus === "REFUNDED") {
        return (
          <RegistrationNotice
            tone="warning"
            title="Payment received after your seat hold ended"
            message="Your payment reached us after the 15-minute seat hold had expired, so this registration couldn't be confirmed. Please don't pay again. Our team has been alerted and will return the full amount to your original payment method. If you have questions, contact support and quote the reference below."
            detail={receipt}
          >
            <Button render={<Link to="/support/new" />}>Contact support</Button>
            <Button variant="outline" render={<Link to={`/mun/${slug}`} />}>Back to conference</Button>
          </RegistrationNotice>
        );
      }
      if (paymentStatus === "FAILED") {
        return (
          <RegistrationNotice
            tone="error"
            title="Payment didn't go through"
            message="No money was taken, and your seat has been released. Registering again picks a fresh seat, subject to availability."
            detail={receipt}
          >
            <Button render={<Link to={`/register/${slug}`} />}>Try again</Button>
            <Button variant="outline" render={<Link to="/support/new" />}>
              Contact support
            </Button>
          </RegistrationNotice>
        );
      }
      return (
        <RegistrationNotice tone="error" title="Your seat hold expired" message="The 15-minute hold ran out before payment was completed, so the seat was released." detail={receipt}>
          <Button render={<Link to={`/register/${slug}`} />}>Start again</Button>
        </RegistrationNotice>
      );
    case "PAYMENT_PENDING":
    case "PENDING":
      return (
        <RegistrationNotice tone="warning" title="Payment still processing" message="Refresh to check again." detail={receipt}>
          <Button render={<Link to={`/register/${slug}/confirmation?registrationId=${encodeURIComponent(registrationId)}`} />}>Refresh status</Button>
          <Button variant="outline" render={<Link to={`/register/${slug}/pay?registrationId=${encodeURIComponent(registrationId)}`} />}>Return to checkout</Button>
        </RegistrationNotice>
      );
    default:
      return (
        <RegistrationNotice tone="neutral" title="Registration status" message={STATUS_LABEL[status]} detail={receipt}>
          <Button render={<Link to={`/mun/${slug}`} />}>Back to conference</Button>
        </RegistrationNotice>
      );
  }
}

function ReceiptRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-md px-md py-sm">
      <dt className="text-body-md text-muted-foreground">{label}</dt>
      <dd className={mono ? "text-right font-mono text-[13px] tabular-nums text-ink" : "text-right text-body-md text-ink"}>{value}</dd>
    </div>
  );
}
