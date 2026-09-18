import * as React from "react";
import { ExternalLinkIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/components/shared/currency";
import type { MockRegistrationDetail } from "@/types";

interface GuruPayCheckoutRedirectProps {
  registration: MockRegistrationDetail;
}

/**
 * Replaces the mock buttons branch of register-pay-page.tsx when
 * `paymentProvider === "gurupay"` (docs/payments/SPEC.md §4.1 step 5,
 * §7). Redirect-based checkout: shows the itemized fee breakdown, then sends
 * the browser to GuruPay's hosted `checkout.paymentUrl` — never an embedded
 * widget.
 *
 * On return from GuruPay (`callback_url`), the pay page's own poll of
 * `GET /registrations/:id` is what decides the outcome (§4.1 step 6/§5) —
 * this component never parses a redirect query param as a trust signal.
 *
 * Double-submit safety (§6 "Double-submit"): this component NEVER calls
 * `initiateRegistration`/creates a new order — it only ever redirects to the
 * already-stored `registration.checkout.paymentUrl`. A re-render (e.g. the
 * user navigating back to this page) redirects to the exact same URL, not a
 * new one.
 */
export function GuruPayCheckoutRedirect({ registration }: GuruPayCheckoutRedirectProps) {
  const checkout = registration.checkout;
  const [redirecting, setRedirecting] = React.useState(false);

  const amountDue = checkout?.amount ?? registration.payment.at(0)?.amount ?? registration.productPrice;
  // Itemized breakdown from the actual fee fields stored on the payment row
  // (checkout.passAmount/platformFeeAmount/platformFeeTaxAmount — see
  // server/routes/registrations.ts) — only when the fields are actually
  // present (older/mock rows have no fee breakdown stored).
  const hasBreakdown =
    checkout?.passAmount != null && checkout?.platformFeeAmount != null && checkout?.platformFeeTaxAmount != null;

  function handleContinue() {
    if (!checkout) return;
    setRedirecting(true);
    window.location.assign(checkout.paymentUrl);
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
          <span className="font-medium text-ink">Secure checkout via GuruPay.</span> You&apos;ll be redirected to
          complete your payment.
        </p>
      </div>
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
