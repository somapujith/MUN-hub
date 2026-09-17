import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, PrinterIcon, ReceiptTextIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta } from "@/components/dashboard/registration-status";
import { formatDateRange } from "@/components/shared/date-range";
import { queryKeys } from "@/api/query-keys";
import { fetchRegistrationReceipt } from "@/api/registration";
import { NotFoundPage } from "@/pages/not-found-page";

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * The delegate's receipt for one registration — owner-only on the server
 * (anyone else gets a 404 and sees "Page not found" here). Deliberately
 * shows no fee split: the platform fee is included in the amount paid.
 */
export function RegistrationReceiptPage() {
  const { registrationId = "" } = useParams();
  const receiptQuery = useQuery({
    queryKey: queryKeys.registrationReceipt(registrationId),
    queryFn: () => fetchRegistrationReceipt(registrationId),
    enabled: registrationId !== "",
    retry: false,
  });
  const receipt = receiptQuery.data;

  if (receiptQuery.isPending && registrationId !== "") {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-lg px-lg py-xxl" aria-busy="true">
          <Skeleton className="h-9 w-[min(100%,16rem)] rounded-sm" />
          <Skeleton className="h-[320px] w-full rounded-md" />
        </main>
        <SiteFooter />
      </div>
    );
  }
  if (!receipt) return <NotFoundPage />;

  const { mun, payment } = receipt;
  const location = [mun.city, mun.country].filter(Boolean).join(", ");
  const paymentMeta = payment ? getPaymentStatusMeta(payment.status) : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>{`Receipt — ${mun.name}`}</title>
      </Helmet>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-xl px-lg py-xxl sm:px-xl">
        <Link
          to="/dashboard"
          className="inline-flex w-fit items-center gap-xs text-body-md text-link underline-offset-4 hover:underline print:hidden"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          Your dashboard
        </Link>

        <header className="flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-xs">
            <p className="inline-flex items-center gap-xs text-caption uppercase text-muted-foreground">
              <ReceiptTextIcon className="size-3.5" aria-hidden />
              Registration receipt
            </p>
            <h1 className="font-display text-display-md text-balance text-ink">{mun.name}</h1>
            <p className="text-body-md text-muted-foreground">
              {formatDateRange(mun.startDate, mun.endDate)}
              {location ? ` · ${location}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" className="w-fit print:hidden" onClick={() => window.print()}>
            <PrinterIcon aria-hidden />
            Print
          </Button>
        </header>

        <section aria-labelledby="receipt-amount" className="flex flex-col gap-md rounded-md border border-border bg-card p-lg">
          <div className="flex items-baseline justify-between gap-md">
            <h2 id="receipt-amount" className="text-label-md text-ink">
              {payment ? "Amount paid" : "Amount"}
            </h2>
            <span className="font-mono text-title-lg tabular-nums text-ink">
              {payment ? formatAmount(payment.amount, payment.currency) : "Free"}
            </span>
          </div>
          {payment && (
            <p className="text-body-md text-muted-foreground">
              Includes MUN Hub&apos;s platform fee and applicable GST on that fee.{" "}
              <Link to="/legal/refunds" className="text-link underline-offset-4 hover:underline">
                All payments are final
              </Link>
              .
            </p>
          )}
        </section>

        <dl className="divide-y divide-border rounded-md border border-border bg-card">
          <ReceiptRow label="Registration status">
            <RegistrationStatusChip status={receipt.status} />
          </ReceiptRow>
          <ReceiptRow label="Pass">{receipt.passName}</ReceiptRow>
          {receipt.committeeName && <ReceiptRow label="Committee">{receipt.committeeName}</ReceiptRow>}
          {receipt.portfolioName && <ReceiptRow label="Portfolio">{receipt.portfolioName}</ReceiptRow>}
          <ReceiptRow label="Registered on">{formatDateTime(receipt.registeredAt)}</ReceiptRow>
          {payment && paymentMeta && (
            <>
              <ReceiptRow label="Payment status">{paymentMeta.label}</ReceiptRow>
              {payment.paidAt && <ReceiptRow label="Paid on">{formatDateTime(payment.paidAt)}</ReceiptRow>}
              <ReceiptRow label="Payment reference" mono>
                {payment.reference ?? "—"}
              </ReceiptRow>
              <ReceiptRow label="Order reference" mono>
                {payment.orderId}
              </ReceiptRow>
            </>
          )}
          <ReceiptRow label="Registration ID" mono>
            {receipt.registrationId}
          </ReceiptRow>
        </dl>

        <p className="text-body-md text-muted-foreground">
          Something wrong with this payment?{" "}
          <Link to="/support/new" className="text-link underline-offset-4 hover:underline">
            Contact support
          </Link>{" "}
          and quote the registration ID.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function ReceiptRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-xxs px-md py-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-md">
      <dt className="shrink-0 text-body-md text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 break-all font-mono text-[13px] tabular-nums text-ink sm:text-right"
            : "min-w-0 text-body-md text-ink sm:text-right"
        }
      >
        {children}
      </dd>
    </div>
  );
}
