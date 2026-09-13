"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, TriangleAlertIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatPrice } from "@/components/shared/currency";
import type { RefundRequestRow } from "@/lib/lifecycle/refund";
import { approveRefundAction, rejectRefundAction } from "./actions";

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

/**
 * One refund_requests row in the admin queue. Approve executes immediately
 * (no reason needed — the request's own `reason` is already shown). Reject
 * opens a confirmation dialog requiring a reason, mirroring the
 * controlled-textarea pattern in `app/admin/organizers/suspend-dialog.tsx` —
 * a Task 3 review caught an uncontrolled textarea breaking the
 * disabled-button gating there, so the reject reason is `useState`-controlled
 * from the start.
 *
 * A `PROCESSING` row (round-3 fix) renders with no Approve/Reject actions at
 * all — `approveRefund`/`rejectRefund` both correctly throw
 * `Invalid transition from PROCESSING to ...` for one, so offering buttons
 * that always fail would just be confusing. This state means a provider
 * call may already have gone through and `approveRefund`'s phase 2 never
 * committed (see the doc comment on `approveRefund` in
 * `lib/lifecycle/refund.ts`) — it needs a human to check the payments
 * provider's dashboard (the refund request's id is the idempotency key used
 * for that call) and reconcile manually. Surfacing it here at all — instead
 * of the round-2 behavior of filtering it out of `listRefundRequests`
 * entirely — is the actual fix: a stuck row that no operator can ever see
 * is exactly as dangerous as one silently reset to re-approvable, since
 * either way nobody notices it needs attention.
 */
export function RefundRow({ request }: { request: RefundRequestRow }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pendingApprove, startApprove] = React.useTransition();
  const [pendingReject, startReject] = React.useTransition();

  const pending = pendingApprove || pendingReject;
  const isProcessing = request.status === "PROCESSING";

  function handleApprove() {
    startApprove(async () => {
      const result = await approveRefundAction(request.id);
      if (!result.ok) {
        toast.error("Could not approve refund", { description: result.error });
        return;
      }
      toast.success("Refund approved and executed", {
        description: `${formatPrice(request.amount)} refunded.`,
      });
    });
  }

  function handleReject() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      // Belt-and-suspenders — the confirm button is already disabled in
      // this case, but never trust the client boundary alone.
      toast.error("A reason is required to reject a refund request.");
      return;
    }

    startReject(async () => {
      const result = await rejectRefundAction(request.id, trimmedReason);
      if (!result.ok) {
        toast.error("Could not reject refund", { description: result.error });
        return;
      }
      setOpen(false);
      setReason("");
      toast.success("Refund request rejected", {
        description: "The registration and payment are unchanged.",
      });
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dialog can also be dismissed via backdrop/Escape, not just Cancel —
      // clear the reason either way so a stale draft never reappears.
      setReason("");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-sm p-md text-body-md">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-xs">
          <p className="font-display text-title-sm font-medium text-ink">{formatPrice(request.amount)}</p>
          {isProcessing && (
            <Badge variant="warning">
              <TriangleAlertIcon aria-hidden />
              Stuck processing
            </Badge>
          )}
        </div>
        <p className="truncate text-muted-foreground">{request.reason}</p>
        {isProcessing && (
          <p className="flex items-start gap-xs rounded-sm border border-warning/30 bg-warning/15 px-sm py-xs text-body-sm text-warning-text">
            A provider call may already have gone through and was never confirmed here. Check the
            payments provider using this request&rsquo;s id ({request.id}) as the idempotency key,
            then reconcile manually — approve/reject are disabled for this row.
          </p>
        )}
      </div>

      {!isProcessing && (
        <div className="flex shrink-0 items-center gap-xs">
          <Button
            size="sm"
            disabled={pending}
            onClick={handleApprove}
          >
            {pendingApprove ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <CheckIcon aria-hidden />
            )}
            {pendingApprove ? "Approving…" : "Approve"}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(true)}>
            <XCircleIcon aria-hidden />
            Reject
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject refund request?</DialogTitle>
            <DialogDescription>
              {formatPrice(request.amount)} stays charged. The registration and payment are left
              exactly as they are — this only records the decision.
            </DialogDescription>
          </DialogHeader>

          <form action={handleReject} className="flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <Label htmlFor={`reject-reason-${request.id}`}>Reason</Label>
              <textarea
                id={`reject-reason-${request.id}`}
                name="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pendingReject}
                className={fieldClassName}
                placeholder="Recorded in the admin action log. Required."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingReject}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={pendingReject || !reason.trim()}
              >
                {pendingReject ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <XCircleIcon aria-hidden />
                )}
                {pendingReject ? "Saving…" : "Confirm reject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
