import { useQuery } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import { getPaymentTimeline } from "@/api/admin-payments";
import { queryKeys } from "@/api/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getToneClassName, type StatusTone } from "@/components/dashboard/registration-status";

interface PaymentTimelineDialogProps {
  /** Null closes the dialog; a paymentId opens it and fetches that payment's timeline. */
  paymentId: string | null;
  onClose: () => void;
}

const OUTCOME_TONE: Record<string, StatusTone> = {
  CONFIRMED: "success",
  DUPLICATE_CAPTURE: "muted",
  FAILED: "destructive",
  IGNORED_FAILURE_AFTER_CAPTURE: "muted",
  UNKNOWN_ORDER: "warning",
  REJECTED_STALE: "warning",
};

function outcomeTone(outcome: string | null): StatusTone {
  if (!outcome) return "info"; // received but not yet processed
  if (outcome.startsWith("EXCEPTION_")) return "warning";
  return OUTCOME_TONE[outcome] ?? "muted";
}

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "Received — not yet processed";
  return outcome
    .replace(/^EXCEPTION_/, "Exception: ")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|: )./, (match) => match.toUpperCase());
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));
}

/**
 * Read-only payment lifecycle view: every `payment_webhook_events` row for
 * one payment, oldest first (order created, webhook received, outcome
 * applied). The only place admin can see this history today — the
 * exceptions queue and the registrations table both only ever show the
 * payment's current status, never how it got there.
 */
export function PaymentTimelineDialog({ paymentId, onClose }: PaymentTimelineDialogProps) {
  const timelineQuery = useQuery({
    queryKey: paymentId ? queryKeys.adminPaymentTimeline(paymentId) : ["admin", "payments", "timeline", "idle"],
    queryFn: () => getPaymentTimeline(paymentId!),
    enabled: paymentId !== null,
  });

  const events = timelineQuery.data?.events ?? [];

  return (
    <Dialog
      open={paymentId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment timeline</DialogTitle>
          <DialogDescription>
            {timelineQuery.data
              ? `Order ${timelineQuery.data.providerOrderId} — every webhook/reconcile event MUN Hub has recorded for this payment, oldest first.`
              : "Every webhook/reconcile event MUN Hub has recorded for this payment, oldest first."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-sm overflow-y-auto">
          {timelineQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading timeline...</p>}
          {timelineQuery.isError && (
            <p className="text-body-md text-destructive">
              {timelineQuery.error instanceof Error
                ? timelineQuery.error.message
                : "Unable to load this payment's timeline right now."}
            </p>
          )}
          {!timelineQuery.isLoading && !timelineQuery.isError && events.length === 0 && (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xl text-center">
              <HistoryIcon className="size-6 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="text-body-md text-muted-foreground">
                No webhook or reconcile events recorded for this payment yet.
              </p>
            </div>
          )}
          {events.length > 0 && (
            <ol className="flex flex-col gap-sm">
              {events.map((event) => (
                <li key={event.id} className="rounded-md border border-border bg-card px-md py-sm">
                  <div className="flex flex-wrap items-center justify-between gap-xs">
                    <span className="font-medium text-ink">{event.eventType ?? "Unknown event"}</span>
                    <Badge variant="outline" className={getToneClassName(outcomeTone(event.outcome))}>
                      {outcomeLabel(event.outcome)}
                    </Badge>
                  </div>
                  <dl className="mt-xs grid grid-cols-[auto_1fr] gap-x-sm gap-y-xxs text-caption text-muted-foreground">
                    <dt>Received</dt>
                    <dd>
                      <time dateTime={event.receivedAt}>{formatTimestamp(event.receivedAt)}</time>
                    </dd>
                    <dt>Processed</dt>
                    <dd>
                      {event.processedAt ? (
                        <time dateTime={event.processedAt}>{formatTimestamp(event.processedAt)}</time>
                      ) : (
                        "Not yet processed"
                      )}
                    </dd>
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
