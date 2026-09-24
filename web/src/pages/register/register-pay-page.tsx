import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCardIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { RegistrationPageSkeleton } from "@/components/registration/registration-page-skeleton";
import { ReservationCountdown } from "@/components/registration/reservation-countdown";
import { hasPassed } from "@/components/registration/deadline";
import { formatPrice } from "@/components/shared/currency";
import { queryKeys } from "@/api/query-keys";
import { CASHFREE_PROVIDER, MOCK_PAYMENT_PROVIDER, completeMockPayment, fetchRegistrationById } from "@/api/registration";
import { CashfreeCheckout } from "@/components/registration/cashfree-checkout";
import { PaymentConfirming } from "@/components/registration/payment-confirming";
import { clearCashfreeCheckoutStarted, hasCashfreeCheckoutStarted } from "@/lib/cashfree";
import { NotFoundPage } from "@/pages/not-found-page";

/**
 * Return-poll window: a redirect back from Cashfree's hosted page carries no
 * trust signal on its own — the only way to learn the real outcome is to
 * keep polling `GET /registrations/:id` until it reaches a terminal state.
 * Phased: fast (2s) for the first minute, since most webhooks arrive within
 * seconds; slower (5s) for the following 4 minutes, since a real production
 * payment was observed taking ~3-4 minutes end to end (mostly the delegate's
 * own time on Cashfree's page, but the webhook itself also races the
 * redirect back). A flat 30s budget (the original value) left the page
 * frozen on stale "still pending" data with no further checks once it ran
 * out, even though the registration went on to confirm seconds later — see
 * the incident this phasing was added to fix. Auto-polling stops after the
 * full budget; PaymentConfirming's manual "Check status now" button and
 * TanStack Query's default refetchOnWindowFocus (web/src/api/query-client.ts)
 * both still work past that point.
 */
const PAY_PAGE_POLL_FAST_INTERVAL_MS = 2_000;
const PAY_PAGE_POLL_FAST_PHASE_MS = 60_000;
const PAY_PAGE_POLL_SLOW_INTERVAL_MS = 5_000;
const PAY_PAGE_POLL_BUDGET_MS = 5 * 60_000;

export function RegisterPayPage() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get("registrationId");
  const error = searchParams.get("error");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paying, setPaying] = React.useState(false);
  const pollStartRef = React.useRef<number>(Date.now());

  const regQuery = useQuery({
    queryKey: queryKeys.registration(registrationId ?? ""),
    queryFn: () => fetchRegistrationById(registrationId!),
    enabled: Boolean(registrationId),
    // Whether online payments are available can change between visits.
    refetchOnMount: "always",
    // Bounded, phased auto-poll for a student landing back on this page
    // after Cashfree's hosted checkout: stops as soon as the registration
    // reaches a terminal state (the query itself flips `enabled` off via
    // `settled` below and this component navigates away) or once the time
    // budget expires, whichever comes first — never polls forever.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const isTerminal = status !== undefined && status !== "PAYMENT_PENDING" && status !== "PENDING";
      if (isTerminal) return false;
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed >= PAY_PAGE_POLL_BUDGET_MS) return false;
      return elapsed < PAY_PAGE_POLL_FAST_PHASE_MS ? PAY_PAGE_POLL_FAST_INTERVAL_MS : PAY_PAGE_POLL_SLOW_INTERVAL_MS;
    },
  });
  const registration = regQuery.data;
  const settled = registration && registration.status !== "PAYMENT_PENDING" && registration.status !== "PENDING";
  const hasReturnedFromCashfree = registrationId ? hasCashfreeCheckoutStarted(registrationId) : false;
  const isTakingLongerThanUsual = Date.now() - pollStartRef.current >= PAY_PAGE_POLL_FAST_PHASE_MS;

  React.useEffect(() => {
    if (!registrationId) {
      navigate(`/register/${slug}`, { replace: true });
    } else if (settled) {
      clearCashfreeCheckoutStarted(registrationId);
      navigate(`/register/${slug}/confirmation?registrationId=${encodeURIComponent(registrationId)}`, { replace: true });
    }
  }, [registrationId, settled, slug, navigate]);

  if (!registrationId || settled) return null;

  if (regQuery.isPending) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <RegistrationPageSkeleton />
        <SiteFooter />
      </div>
    );
  }
  if (!registration) return <NotFoundPage />;

  const mun = registration.mun;
  const id = registrationId;
  const expired = registration.expiresAt ? hasPassed(registration.expiresAt) : false;
  // The amount on the order (early-bird and extras included) — the pass's
  // list price only as a fallback while the order is still being created.
  const currentPayment = registration.payment.at(0);
  const amountDue = currentPayment?.amount ?? registration.productPrice;
  const provider = registration.paymentProvider ?? null;
  // Itemized breakdown for the mock checkout branch (docs/payments/SPEC.md
  // §11 Q7 — consistent copy across providers), only when the stored payment
  // row actually has a fee breakdown (older/pre-fee-model rows don't).
  const mockFeeBreakdown =
    currentPayment?.passAmount != null &&
    currentPayment?.platformFeeAmount != null &&
    currentPayment?.platformFeeTaxAmount != null
      ? { passAmount: currentPayment.passAmount, fee: currentPayment.platformFeeAmount + currentPayment.platformFeeTaxAmount }
      : null;

  async function handlePay(outcome: "success" | "failure") {
    setPaying(true);
    try {
      await completeMockPayment(id, outcome);
      await queryClient.invalidateQueries({ queryKey: queryKeys.registration(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboardUpcoming() });
      navigate(`/register/${slug}/confirmation?registrationId=${encodeURIComponent(id)}`);
    } catch {
      setPaying(false);
      navigate(
        `/register/${slug}/pay?registrationId=${encodeURIComponent(id)}&error=webhook`,
        { replace: true },
      );
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet><title>Checkout | MUN Hub</title></Helmet>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        <header className="flex flex-col gap-xs">
          <p className="text-caption uppercase text-muted-foreground">Secure checkout</p>
          <h1 className="font-display text-display-md text-ink text-balance">Complete your payment</h1>
          <p className="text-body-md text-muted-foreground">{mun.name} · {registration.productName}</p>
        </header>
        {expired ? (
          <RegistrationNotice tone="warning" title="Your seat hold expired" message="Start again to reserve a fresh seat.">
            <Button render={<Link to={`/register/${slug}`} />}>Start over</Button>
          </RegistrationNotice>
        ) : provider === CASHFREE_PROVIDER ? (
          <>
            {registration.expiresAt && <ReservationCountdown expiresAt={registration.expiresAt} />}
            {hasReturnedFromCashfree ? (
              <PaymentConfirming
                registrationId={registration.id}
                isTakingLongerThanUsual={isTakingLongerThanUsual}
                isChecking={regQuery.isFetching}
                onCheckNow={() => regQuery.refetch()}
              />
            ) : (
              <CashfreeCheckout registration={registration} />
            )}
            <p className="text-body-md text-muted-foreground">
              <Link to="/legal/refunds" className="text-link underline-offset-4 hover:underline">
                All payments are final
              </Link>
              .
            </p>
          </>
        ) : provider !== MOCK_PAYMENT_PROVIDER ? (
          // No usable checkout: online payments are switched off (or the
          // configured provider has no checkout in this app yet). Never fall
          // back to the mock buttons.
          <RegistrationNotice
            tone="neutral"
            title="Online payments aren't available yet"
            message="We can't take payments right now, so this seat hold will lapse unpaid. Please try registering again later."
          >
            <Button render={<Link to={`/mun/${slug}`} />}>Back to conference</Button>
            <Button variant="outline" render={<Link to="/dashboard" />}>Your dashboard</Button>
          </RegistrationNotice>
        ) : (
          <>
            {error === "webhook" && (
              <RegistrationNotice tone="error" title="Payment processor unreachable" message="Your seat is still held." />
            )}
            {registration.expiresAt && <ReservationCountdown expiresAt={registration.expiresAt} />}
            <section className="flex flex-col gap-lg rounded-md border border-border p-lg sm:p-xl">
              {mockFeeBreakdown ? (
                <dl className="flex flex-col gap-xs border-b border-border pb-md text-body-md">
                  <div className="flex items-baseline justify-between gap-md">
                    <dt className="text-muted-foreground">Registration</dt>
                    <dd className="font-mono tabular-nums text-ink">{formatPrice(mockFeeBreakdown.passAmount)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-md">
                    <dt className="text-muted-foreground">Platform fee (incl. GST)</dt>
                    <dd className="font-mono tabular-nums text-ink">{formatPrice(mockFeeBreakdown.fee)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-md pt-xs">
                    <dt className="text-label-md text-ink">Total</dt>
                    <dd className="font-mono text-title-lg tabular-nums text-ink">{formatPrice(amountDue)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="flex items-baseline justify-between gap-md border-b border-border pb-md">
                  <span className="text-label-md text-ink">Amount due</span>
                  <span className="font-mono text-title-lg tabular-nums text-ink">{formatPrice(amountDue)}</span>
                </div>
              )}
              <p className="text-body-md text-muted-foreground">
                <Link to="/legal/refunds" className="text-link underline-offset-4 hover:underline">
                  All payments are final
                </Link>
                .
              </p>
              <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
                <ShieldCheckIcon className="mt-px size-4 shrink-0" aria-hidden />
                <p><span className="font-medium text-ink">Mock provider.</span> No real card is charged.</p>
              </div>
              <div className="flex flex-col gap-sm sm:flex-row">
                <Button size="lg" className="sm:flex-1" disabled={paying} onClick={() => handlePay("success")}>
                  <CreditCardIcon aria-hidden />
                  Pay {formatPrice(amountDue)}
                </Button>
                <Button size="lg" variant="outline" disabled={paying} onClick={() => handlePay("failure")}>
                  Simulate failure
                </Button>
              </div>
              <p className="flex items-center gap-xs text-body-md text-muted-foreground">
                <LockIcon className="size-3.5" aria-hidden />
                Reference <code className="font-mono text-[13px] text-ink">{registration.id}</code>
              </p>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
