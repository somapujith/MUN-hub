import * as React from "react";
import { ExternalLinkIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/components/shared/currency";
import { CASHFREE_MODE, loadCashfreeSdk, markCashfreeCheckoutStarted } from "@/lib/cashfree";
import type { MockRegistrationDetail } from "@/types";

interface CashfreeCheckoutProps {
  registration: MockRegistrationDetail;
}

/**
 * Replaces the mock buttons branch of register-pay-page.tsx when
 * `paymentProvider === "cashfree"`. SDK-driven checkout: shows the itemized
 * fee breakdown, then loads Cashfree's JS SDK and calls
 * `cashfree.checkout({ paymentSessionId, redirectTarget: "_self" })`, which
 * performs the actual browser redirect — Cashfree has no plain hosted-
 * checkout URL to redirect to directly.
 *
 * On return from Cashfree (`order_meta.return_url`), the pay page's own poll
 * of `GET /registrations/:id` is what decides the outcome — this component
 * never parses a redirect query param as a trust signal.
 *
 * Double-submit safety: this component NEVER calls `initiateRegistration`/
 * creates a new order — it only ever reuses the already-stored
 * `registration.checkout.paymentSessionId`. A re-render (e.g. the user
 * navigating back to this page) reuses the exact same session id, not a new
 * one.
 */
export function CashfreeCheckout({ registration }: CashfreeCheckoutProps) {
  const checkout = registration.checkout;
  const [redirecting, setRedirecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const amountDue = checkout?.amount ?? registration.payment.at(0)?.amount ?? registration.productPrice;
  const hasBreakdown =
    checkout?.passAmount != null && checkout?.platformFeeAmount != null && checkout?.platformFeeTaxAmount != null;

  async function handleContinue() {
    if (!checkout) return;
    setRedirecting(true);
    setError(null);
    try {
      const Cashfree = await loadCashfreeSdk();
      const cashfree = Cashfree({ mode: CASHFREE_MODE });
      // Set BEFORE the redirect, not after: redirectTarget "_self" is a full
      // top-level navigation away from the app, so nothing after this call
      // that depends on the redirect actually happening is guaranteed to run.
      markCashfreeCheckoutStarted(registration.id);
      await cashfree.checkout({ paymentSessionId: checkout.paymentSessionId, redirectTarget: "_self" });
      // redirectTarget "_self" navigates the browser away on success; if we
      // get here the SDK itself failed to initiate the redirect.
    } catch {
      setRedirecting(false);
      setError("Couldn't open the payment page. Please try again.");
    }
  }

  if (!checkout) {
    return null;
  }

  return (
    <section className="flex flex-col gap-lg rounded-md border border-border p-lg sm:p-xl">
      {hasBreakdown ? (
        <dl className="flex flex-col gap-xs border-b border-border pb-md text-body-md">
          <div className="flex items-baseline justify-between gap-md">
            <dt className="text-muted-foreground">Registration</dt>
            <dd className="font-mono tabular-nums text-ink">{formatPrice(checkout.passAmount)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-md">
            <dt className="text-muted-foreground">Platform fee (incl. GST)</dt>
            <dd className="font-mono tabular-nums text-ink">
              {formatPrice((checkout.platformFeeAmount ?? 0) + (checkout.platformFeeTaxAmount ?? 0))}
            </dd>
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
      <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-medium text-ink">Secure checkout via Cashfree.</span> You&apos;ll be redirected to
          complete your payment.
        </p>
      </div>
      {error && <p className="text-body-md text-destructive">{error}</p>}
      <Button size="lg" disabled={redirecting} onClick={handleContinue}>
        <ExternalLinkIcon aria-hidden />
        {redirecting ? "Redirecting…" : `Pay ${formatPrice(amountDue)}`}
      </Button>
      <p className="flex items-center gap-xs text-body-md text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden />
        Reference <code className="font-mono text-[13px] text-ink">{registration.id}</code>
      </p>
    </section>
  );
}
