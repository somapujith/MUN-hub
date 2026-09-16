import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardListIcon } from "lucide-react";
import { toast } from "sonner";
import { getMunForReview, getReviewQueue, reviewMunApplication } from "@/api/admin-review";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { ReviewDecision, ReviewQueueRow } from "@/types/admin-review";

const PAGE_SIZE = 20;

const DECISION_OPTIONS: Array<{ value: ReviewDecision; label: string }> = [
  { value: "APPROVED", label: "Approve" },
  { value: "CHANGES_REQUESTED", label: "Request changes" },
  { value: "REJECTED", label: "Reject" },
];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Gate 1 — organizer-APPLICATION approval queue ("is this organization
 * allowed to run a MUN on our platform"). Wraps `getReviewQueue` /
 * `reviewMunApplication` (lib/actions/admin-review.ts). This is NEVER the
 * MUN-content review gate — see `AdminVerificationPage` for that (Gate 2,
 * module-level, a completely different table and action).
 */
export function AdminReviewPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [reviewTarget, setReviewTarget] = useState<ReviewQueueRow | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("APPROVED");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const queueQuery = useQuery({
    queryKey: queryKeys.adminReviewQueue(params),
    queryFn: () => getReviewQueue(params),
    placeholderData: (previous) => previous,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.adminMunReview(reviewTarget?.id ?? ""),
    queryFn: () => getMunForReview(reviewTarget!.id),
    enabled: reviewTarget !== null,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "review-queue"] });

  const closeDialog = () => {
    setReviewTarget(null);
    setNotes("");
    setInternalNotes("");
    setDecision("APPROVED");
  };

  const decideMutation = useMutation({
    mutationFn: () =>
      reviewMunApplication(reviewTarget!.id, {
        decision,
        notes: notes.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(
        decision === "APPROVED"
          ? "Application approved"
          : decision === "REJECTED"
            ? "Application rejected"
            : "Changes requested from organizer",
      );
      closeDialog();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record decision"),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    decideMutation.mutate();
  };

  const results = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminPageFrame
      title="Applications"
      description="Gate 1 — organizer application approval queue. Deciding here approves or rejects the organization's right to run this MUN; it does not review the MUN's content (see Verification)."
    >
      {queueQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : queueQuery.isError ? (
        <p className="text-body-md text-destructive">
          {queueQuery.error instanceof Error ? queueQuery.error.message : "Unable to load the review queue right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <ClipboardListIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">Nothing waiting on a decision.</p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            New organizer applications land here once they're submitted for review.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[40rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">MUN</th>
                <th className="px-md py-sm font-medium">Location</th>
                <th className="px-md py-sm font-medium">Status</th>
                <th className="px-md py-sm font-medium">Submitted</th>
                <th className="px-md py-sm font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-md py-sm font-medium text-ink">{row.name}</td>
                  <td className="px-md py-sm text-muted-foreground">
                    {[row.city, row.country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-md py-sm">
                    <MunStatusBadge status={row.status} />
                  </td>
                  <td className="px-md py-sm tabular-nums text-muted-foreground">{formatDate(row.createdAt)}</td>
                  <td className="px-md py-sm text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReviewTarget(row);
                        setDecision("APPROVED");
                        setNotes("");
                        setInternalNotes("");
                      }}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
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

      <Dialog
        open={reviewTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>Review {reviewTarget?.name}</DialogTitle>
              <DialogDescription>
                Gate 1 decision — approves or rejects the organizing entity, not the MUN's content.
              </DialogDescription>
            </DialogHeader>

            {detailQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : detailQuery.data ? (
              <div className="flex flex-col gap-sm rounded-md border border-border bg-surface-soft/60 p-md text-body-md">
                <p>
                  <span className="text-muted-foreground">Application submitted:</span>{" "}
                  {detailQuery.data.organizerApplication
                    ? formatDate(detailQuery.data.organizerApplication.submittedAt)
                    : "—"}
                </p>
                {detailQuery.data.organizerApplication?.reviewNotes && (
                  <p>
                    <span className="text-muted-foreground">Previous notes:</span>{" "}
                    {detailQuery.data.organizerApplication.reviewNotes}
                  </p>
                )}
                {detailQuery.data.verificationLogs.length > 0 && (
                  <div className="flex flex-col gap-xs">
                    <span className="text-muted-foreground">History</span>
                    <ul className="flex flex-col gap-xxs">
                      {detailQuery.data.verificationLogs.map((log) => (
                        <li key={log.id} className="text-body-md text-body">
                          {formatDate(log.createdAt)} — {log.action}
                          {log.notes ? `: ${log.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex flex-col gap-xs">
              <Label htmlFor="review-decision">Decision</Label>
              <select
                id="review-decision"
                className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                value={decision}
                onChange={(event) => setDecision(event.target.value as ReviewDecision)}
              >
                {DECISION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="review-notes">Notes to organizer</Label>
              <textarea
                id="review-notes"
                className="min-h-20 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={
                  decision === "APPROVED" ? "Optional — shown to the organizer" : "What needs to change or why this was rejected"
                }
              />
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="review-internal-notes">Internal notes (ops only)</Label>
              <textarea
                id="review-internal-notes"
                className="min-h-16 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                value={internalNotes}
                onChange={(event) => setInternalNotes(event.target.value)}
                placeholder="Never shown to the organizer"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant={decision === "REJECTED" ? "destructive" : "default"}
                disabled={decideMutation.isPending}
              >
                {decideMutation.isPending
                  ? "Submitting..."
                  : (DECISION_OPTIONS.find((o) => o.value === decision)?.label ?? "Submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminPageFrame>
  );
}
