import { RotateCcwIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/components/mun/mun-format";

interface PaymentAbandonedProps {
  registrationId: string;
  /**
   * The registration's real seat-hold deadline (`registrations.expiresAt`,
   * `RESERVATION_TTL_MS` in lib/actions/registration.ts — 15 minutes),
   * mirrored here purely for the "still held until…" sentence. The live
   * countdown itself is the `ReservationCountdown` register-pay-page.tsx
   * already renders above this component — this text is static so it never
   * competes with that ticking display.
   */
  expiresAt: Date | null;
  /** Re-shows CashfreeCheckout, which reuses the existing `checkout.paymentSessionId` rather than starting a new order. */
  onRetry: () => void;
  onCheckNow: () => void;
  isChecking: boolean;
}

/**
 * Shown on the pay page once the bounded return-poll (`PAY_PAGE_POLL_BUDGET_MS`
 * in register-pay-page.tsx, 5 minutes) has given up waiting for Cashfree's
 * webhook, but the registration's own seat hold hasn't actually expired yet
 * (`RESERVATION_TTL_MS`, 15 minutes server-side — comfortably longer than the
 * poll budget). Most often this means the student closed or backed out of
 * Cashfree's hosted page without finishing, or the webhook is unusually
 * delayed.
 *
 * Deliberately a third state, distinct from both:
 *  - PaymentConfirming, whose "we're waiting to hear back" / "still being
 *    confirmed" copy implies an answer is imminent — no longer honest once
 *    auto-polling has actually stopped.
 *  - the "Your seat hold expired" panel, which implies the hold is gone —
 *    also wrong here, there's still time on the clock.
 *
 * Never claims the payment failed outright — the webhook can still land and
 * settle the registration after this point, which is why "Check status now"
 * stays alongside "Retry payment" rather than replacing it.
 */
export function PaymentAbandoned({ registrationId, expiresAt, onRetry, onCheckNow, isChecking }: PaymentAbandonedProps) {
  return (
    <section className="flex flex-col items-center gap-lg rounded-md border border-warning/40 bg-warning/12 p-lg text-center sm:p-xl">
      <TriangleAlertIcon className="size-8 text-warning-text" aria-hidden />
      <div className="flex flex-col gap-xs">
        <h2 className="text-title-md text-ink">We didn&apos;t hear back about your payment</h2>
        <p className="text-body-md text-muted-foreground">
          It looks like checkout didn&apos;t finish — maybe the page was closed before payment completed.
          {expiresAt
            ? ` Your seat is still held until ${formatTime(expiresAt)}, so there's time to try again.`
            : " Your seat is still held, so there's time to try again."}
        </p>
      </div>
      <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-4 shrink-0" aria-hidden />
        <p>If money left your account, it&apos;s accounted for — checking status will confirm it without charging you again.</p>
      </div>
      <div className="flex flex-col gap-sm sm:flex-row">
        <Button size="lg" onClick={onRetry}>
          <RotateCcwIcon aria-hidden />
          Retry payment
        </Button>
        <Button variant="outline" disabled={isChecking} onClick={onCheckNow}>
          {isChecking ? "Checking…" : "Check status now"}
        </Button>
      </div>
      <p className="text-body-md text-muted-foreground">
        Reference <code className="font-mono text-[13px] text-ink">{registrationId}</code>
      </p>
    </section>
  );
}
