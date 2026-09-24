import { Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaymentConfirmingProps {
  registrationId: string;
  /** True once we've been waiting long enough that "any second now" copy would be misleading. */
  isTakingLongerThanUsual: boolean;
  onCheckNow: () => void;
  isChecking: boolean;
}

/**
 * Shown on the pay page once the browser has come back from Cashfree's
 * hosted checkout (see web/src/lib/cashfree.ts#hasCashfreeCheckoutStarted)
 * but the registration hasn't settled yet — replaces the "Pay" card so a
 * returning student sees active, reassuring feedback instead of the same
 * checkout button again, which reads as "nothing happened" and invites a
 * manual refresh or a second payment attempt.
 *
 * The confirmation itself only ever comes from the payments webhook
 * (lib/payments/webhook.ts) settling the registration — this component never
 * claims success on its own, it only describes the wait and offers a manual
 * recheck for the impatient/anxious case.
 */
export function PaymentConfirming({ registrationId, isTakingLongerThanUsual, onCheckNow, isChecking }: PaymentConfirmingProps) {
  return (
    <section className="flex flex-col items-center gap-lg rounded-md border border-border p-lg text-center sm:p-xl">
      <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-xs">
        <h2 className="text-title-md text-ink">Confirming your payment…</h2>
        <p className="text-body-md text-muted-foreground">
          {isTakingLongerThanUsual
            ? "This is taking longer than usual, but your payment is still being confirmed. You don't need to pay again or start over."
            : "We're waiting to hear back from Cashfree. This is usually quick — no need to refresh, we'll take you to your confirmation automatically."}
        </p>
      </div>
      <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-4 shrink-0" aria-hidden />
        <p>If money left your account, it's accounted for — this page will update the moment we confirm it.</p>
      </div>
      <Button variant="outline" disabled={isChecking} onClick={onCheckNow}>
        {isChecking ? "Checking…" : "Check status now"}
      </Button>
      <p className="text-body-md text-muted-foreground">
        Reference <code className="font-mono text-[13px] text-ink">{registrationId}</code>
      </p>
    </section>
  );
}
