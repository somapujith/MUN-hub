import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RocketIcon } from "lucide-react";
import { toast } from "sonner";
import { enqueueForGoLive, getGoLiveQueue, publishFromQueue } from "@/api/go-live";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SlaState, SubmissionStatus } from "@/types/go-live";

const PAGE_SIZE = 20;

const SLA_META: Record<SlaState, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "info" }> = {
  ON_TRACK: { label: "On track", variant: "success" },
  DUE_SOON: { label: "Due soon", variant: "warning" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
  PAUSED: { label: "Paused", variant: "secondary" },
  COMPLETED: { label: "Completed", variant: "info" },
};

const SUBMISSION_STATUS_META: Record<SubmissionStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "info" | "outline" }> = {
  SUBMITTED: { label: "Submitted", variant: "info" },
  UNDER_REVIEW: { label: "Under review", variant: "info" },
  CHANGES_REQUESTED: { label: "Changes requested", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  QUEUED: { label: "Queued", variant: "secondary" },
  PUBLISHED: { label: "Published", variant: "success" },
  WITHDRAWN: { label: "Withdrawn", variant: "outline" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AdminGoLiveQueuePage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  // One idempotency key per in-flight publish attempt, keyed by munId —
  // reused across a retry of the SAME attempt (never regenerated on retry),
  // per publishFromQueue's docstring. Cleared once that mun's publish
  // succeeds; kept on failure so a retry replays safely instead of risking
  // a second real publish.
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map());

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const queueQuery = useQuery({
    queryKey: queryKeys.adminGoLiveQueue(params),
    queryFn: () => getGoLiveQueue(params),
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "go-live-queue"] });

  const enqueueMutation = useMutation({
    mutationFn: enqueueForGoLive,
    onSuccess: async () => {
      await refresh();
      toast.success("Moved to the go-live queue");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to queue this mun"),
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

  const results = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const readyToPublishCount = results.filter((row) => row.munStatus === "GO_LIVE_QUEUE").length;

  return (
    <AdminPageFrame
      title="Go-live queue"
      description="Gate 2 — MUNs that have cleared content review and are on their way to going live. SLA is computed on read, never a stale snapshot."
    >
      {total > 0 && (
        <dl className="flex items-center gap-lg">
          <div className="flex flex-col gap-0.5">
            <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              In pipeline
            </dt>
            <dd className="font-display text-title-lg tabular-nums text-ink">{total}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Ready to publish (this page)
            </dt>
            <dd className="font-display text-title-lg tabular-nums text-ink">{readyToPublishCount}</dd>
          </div>
        </dl>
      )}

      {queueQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
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
            MUNs appear here once an organizer submits for review and haven&apos;t yet published.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[56rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">MUN</th>
                <th className="px-md py-sm font-medium">Lifecycle status</th>
                <th className="px-md py-sm font-medium">Submission</th>
                <th className="px-md py-sm font-medium">Submitted</th>
                <th className="px-md py-sm font-medium">SLA deadline</th>
                <th className="px-md py-sm font-medium">SLA state</th>
                <th className="px-md py-sm font-medium">Queued</th>
                <th className="px-md py-sm font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => {
                const sla = SLA_META[row.slaState];
                const submission = SUBMISSION_STATUS_META[row.submissionStatus];
                const isEnqueuing = enqueueMutation.isPending && enqueueMutation.variables === row.munId;
                const isPublishing = publishMutation.isPending && publishMutation.variables === row.munId;

                return (
                  <tr key={row.submissionId} className="border-b border-border last:border-0">
                    <td className="px-md py-sm font-medium text-ink">{row.munName}</td>
                    <td className="px-md py-sm">
                      <MunStatusBadge status={row.munStatus} />
                    </td>
                    <td className="px-md py-sm">
                      <Badge variant={submission.variant}>{submission.label}</Badge>
                    </td>
                    <td className="px-md py-sm tabular-nums text-muted-foreground">{formatDate(row.submittedAt)}</td>
                    <td className="px-md py-sm tabular-nums text-muted-foreground">{formatDate(row.slaDeadline)}</td>
                    <td className="px-md py-sm">
                      <Badge variant={sla.variant}>{sla.label}</Badge>
                    </td>
                    <td className="px-md py-sm tabular-nums text-muted-foreground">{formatDate(row.queuedAt)}</td>
                    <td className="px-md py-sm text-right">
                      {row.munStatus === "GO_LIVE_QUEUE" ? (
                        <Button
                          size="sm"
                          disabled={isPublishing}
                          onClick={() => {
                            if (window.confirm(`Publish ${row.munName}? It will immediately go live on the public marketplace.`)) {
                              publishMutation.mutate(row.munId);
                            }
                          }}
                        >
                          {isPublishing ? "Publishing…" : "Publish"}
                        </Button>
                      ) : row.munStatus === "VERIFIED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isEnqueuing}
                          onClick={() => enqueueMutation.mutate(row.munId)}
                        >
                          {isEnqueuing ? "Queueing…" : "Queue for go-live"}
                        </Button>
                      ) : (
                        <span className="text-body-md text-muted-foreground">Awaiting Gate 2 decision</span>
                      )}
                    </td>
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
    </AdminPageFrame>
  );
}
