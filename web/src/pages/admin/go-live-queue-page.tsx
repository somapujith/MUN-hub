import { useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RocketIcon } from "lucide-react";
import { toast } from "sonner";
import { enqueueForGoLive, getGoLiveQueueDetails, publishFromQueue } from "@/api/go-live";
import { setPaymentVerificationState } from "@/api/payment-settlement";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Gate2ReviewDialog } from "@/components/admin/gate2-review-dialog";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatAdminDate,
  paymentVerificationMeta,
  SLA_META,
  SUBMISSION_STATUS_META,
} from "@/lib/admin/go-live-labels";
import { useAdminPermissions } from "@/lib/admin/permissions";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { usePageClamp } from "@/lib/admin/use-page-clamp";
import type { GoLiveQueueDetailRow } from "@/types/admin-muns";
import type { PaymentVerificationState } from "@/types/payment-settlement";

const PAGE_SIZE = 20;

const statLabelClassName = "text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase";

/**
 * Gate 2 publish pipeline: every MUN with an active submission. Staff review
 * the submitted content here (approve / request changes / reject); admins
 * also verify the payout account, queue approved MUNs and publish them.
 * OPERATIONS never sees the queue/publish/verify controls — the server
 * refuses them anyway.
 */
export function AdminGoLiveQueuePage() {
  const queryClient = useQueryClient();
  const { canPublish } = useAdminPermissions();
  const [page, setPage] = useState(0);
  const [reviewTarget, setReviewTarget] = useState<{ munId: string; munName: string } | null>(null);
  // One idempotency key per in-flight publish attempt, keyed by munId —
  // reused across a retry of the SAME attempt (never regenerated on retry),
  // per publishFromQueue's docstring. Cleared once that mun's publish
  // succeeds; kept on failure so a retry replays safely instead of risking
  // a second real publish.
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map());

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const queueQuery = useQuery({
    queryKey: adminQueryKeys.goLiveQueueDetails(params),
    queryFn: () => getGoLiveQueueDetails(params),
    placeholderData: (previous) => previous,
  });

  // The queue feeds the overview counts and the conference pages too.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "go-live-queue"] }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.munsAll() }),
      queryClient.invalidateQueries({ queryKey: ["admin", "overview"] }),
    ]);

  const enqueueMutation = useMutation({
    mutationFn: enqueueForGoLive,
    onSuccess: async () => {
      await refresh();
      toast.success("Moved to the go-live queue");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to queue this MUN"),
  });

  const publishMutation = useMutation({
    mutationFn: (munId: string) => {
      let key = idempotencyKeysRef.current.get(munId);
      if (!key) {
        key = crypto.randomUUID();
        idempotencyKeysRef.current.set(munId, key);
      }
      return publishFromQueue(munId, key);
    },
    onSuccess: async (result, munId) => {
      idempotencyKeysRef.current.delete(munId);
      await refresh();
      toast.success(result.replay ? "Already published — no change made." : `${result.mun.name} is now live.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to publish"),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ munId, state }: { munId: string; state: PaymentVerificationState }) =>
      setPaymentVerificationState(munId, state),
    onSuccess: async (_result, { state }) => {
      await refresh();
      toast.success(state === "VERIFIED" ? "Payment account verified" : "Payment account marked as failed");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to update the payment account"),
  });

  const results = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  usePageClamp(Boolean(queueQuery.data), page, setPage, totalPages);
  const awaitingReviewCount = results.filter((row) => row.munStatus === "VERIFICATION").length;
  const readyToPublishCount = results.filter((row) => row.munStatus === "GO_LIVE_QUEUE").length;
  const overdueCount = results.filter((row) => row.slaState === "OVERDUE").length;

  const confirmPayment = (row: GoLiveQueueDetailRow, state: PaymentVerificationState) => {
    const message =
      state === "VERIFIED"
        ? `Mark ${row.munName}'s payout account as verified? Do this only after checking the account off-platform.`
        : `Mark ${row.munName}'s payout account as failed? The organizer will need to fix their payout details.`;
    if (window.confirm(message)) paymentMutation.mutate({ munId: row.munId, state });
  };

  const renderAction = (row: GoLiveQueueDetailRow) => {
    const isEnqueuing = enqueueMutation.isPending && enqueueMutation.variables === row.munId;
    const isPublishing = publishMutation.isPending && publishMutation.variables === row.munId;

    switch (row.munStatus) {
      case "VERIFICATION":
        return (
          <Button size="sm" onClick={() => setReviewTarget({ munId: row.munId, munName: row.munName })}>
            Review
          </Button>
        );
      case "VERIFIED":
        return canPublish ? (
          <Button size="sm" variant="outline" disabled={isEnqueuing} onClick={() => enqueueMutation.mutate(row.munId)}>
            {isEnqueuing ? "Queueing…" : "Queue for go-live"}
          </Button>
        ) : (
          <span className="text-body-md text-muted-foreground">Approved, waiting for an admin</span>
        );
      case "GO_LIVE_QUEUE": {
        if (!canPublish) {
          return <span className="text-body-md text-muted-foreground">Queued, waiting for an admin</span>;
        }
        const paymentReady = row.paymentVerificationState === "VERIFIED";
        return (
          <div className="flex flex-col items-end gap-xxs">
            <Button
              size="sm"
              disabled={isPublishing || !paymentReady}
              onClick={() => {
                if (window.confirm(`Publish ${row.munName}? It will go live on the public marketplace immediately.`)) {
                  publishMutation.mutate(row.munId);
                }
              }}
            >
              {isPublishing ? "Publishing…" : "Publish"}
            </Button>
            {!paymentReady && (
              <span className="text-body-md text-muted-foreground">Verify the payment account first</span>
            )}
          </div>
        );
      }
      case "ORGANIZER_CONFIRMATION":
        return <span className="text-body-md text-muted-foreground">Waiting for organizer confirmation</span>;
      case "ACTION_REQUIRED":
        return <span className="text-body-md text-muted-foreground">Waiting for organizer changes</span>;
      default:
        return <span className="text-body-md text-muted-foreground">—</span>;
    }
  };

  return (
    <AdminPageFrame
      title="Go-live queue"
      description="Gate 2 — MUNs submitted for content review, on their way to going live. SLA is computed on read, never a stale snapshot."
    >
      {total > 0 && (
        <dl className="flex flex-wrap items-center gap-lg">
          <div className="flex flex-col gap-0.5">
            <dt className={statLabelClassName}>In pipeline</dt>
            <dd className="font-display text-title-lg tabular-nums text-ink">{total}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={statLabelClassName}>Awaiting review (this page)</dt>
            <dd className="font-display text-title-lg tabular-nums text-ink">{awaitingReviewCount}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={statLabelClassName}>Ready to publish (this page)</dt>
            <dd className="font-display text-title-lg tabular-nums text-ink">{readyToPublishCount}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={statLabelClassName}>Overdue (this page)</dt>
            <dd className="font-display text-title-lg tabular-nums text-ink">{overdueCount}</dd>
          </div>
        </dl>
      )}

      {queueQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : queueQuery.isError ? (
        <p className="text-body-md text-destructive">
          {queueQuery.error instanceof Error ? queueQuery.error.message : "Unable to load the go-live queue right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <RocketIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">Nothing in the pipeline.</p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            MUNs appear here once an organizer submits for review and stay until they publish.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[64rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">MUN</th>
                <th className="px-md py-sm font-medium">Status</th>
                <th className="px-md py-sm font-medium">SLA</th>
                <th className="px-md py-sm font-medium">Reviewer</th>
                <th className="px-md py-sm font-medium">Payment account</th>
                <th className="px-md py-sm text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => {
                const sla = SLA_META[row.slaState];
                const submission = SUBMISSION_STATUS_META[row.submissionStatus];
                const payment = paymentVerificationMeta(row.paymentVerificationState);
                const isUpdatingPayment = paymentMutation.isPending && paymentMutation.variables?.munId === row.munId;

                return (
                  <tr key={row.submissionId} className="border-b border-border align-top last:border-0">
                    <td className="px-md py-sm">
                      <Link to={`/admin/muns/${row.munId}`} className="font-medium text-link hover:text-link-active">
                        {row.munName}
                      </Link>
                      <p className="text-body-md text-muted-foreground">{row.organizerName}</p>
                      <p className="text-body-md whitespace-nowrap tabular-nums text-muted-foreground">
                        Submitted {formatAdminDate(row.submittedAt)}
                      </p>
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex flex-col items-start gap-xxs">
                        <MunStatusBadge status={row.munStatus} />
                        <Badge variant={submission.variant}>Submission: {submission.label}</Badge>
                      </div>
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex flex-col items-start gap-xxs">
                        <Badge variant={sla.variant}>{sla.label}</Badge>
                        <span className="text-body-md whitespace-nowrap tabular-nums text-muted-foreground">
                          Due {formatAdminDate(row.slaDeadline)}
                        </span>
                      </div>
                    </td>
                    <td className="px-md py-sm">
                      {row.reviewerName ? (
                        <span className="text-ink">{row.reviewerName}</span>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex flex-col items-start gap-xs">
                        <Badge variant={payment.variant}>{payment.label}</Badge>
                        {canPublish && row.paymentVerificationState !== null && (
                          <div className="flex flex-wrap gap-xs">
                            {row.paymentVerificationState !== "VERIFIED" && (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={isUpdatingPayment}
                                onClick={() => confirmPayment(row, "VERIFIED")}
                              >
                                Verify
                              </Button>
                            )}
                            {row.paymentVerificationState !== "FAILED" && (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={isUpdatingPayment}
                                onClick={() => confirmPayment(row, "FAILED")}
                              >
                                Reject
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-md py-sm text-right">{renderAction(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-md border-t border-border px-md py-sm">
              <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <p className="text-body-md tabular-nums text-muted-foreground">
                Page {page + 1} of {totalPages}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      <Gate2ReviewDialog target={reviewTarget} onClose={() => setReviewTarget(null)} onDecided={refresh} />
    </AdminPageFrame>
  );
}
