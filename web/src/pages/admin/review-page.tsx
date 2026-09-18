import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardListIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { adminSelectClassName } from "@/lib/admin/styles";
import { usePageClamp } from "@/lib/admin/use-page-clamp";
import type { ApplicationStatus, ReviewDecision, ReviewQueueRow } from "@/types/admin-review";

const PAGE_SIZE = 20;

const DECISION_OPTIONS: Array<{ value: ReviewDecision; label: string }> = [
  { value: "APPROVED", label: "Approve" },
  { value: "CHANGES_REQUESTED", label: "Request changes" },
  { value: "REJECTED", label: "Reject" },
];

const STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
  { value: "SUBMITTED", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CHANGES_REQUESTED", label: "Changes requested" },
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
  const [status, setStatus] = useState<ApplicationStatus>("SUBMITTED");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ReviewQueueRow | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("APPROVED");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [showReasonError, setShowReasonError] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = { status, q: search || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
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
    setShowReasonError(false);
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

  // Admin PRD §8: rejecting or requesting changes must tell the organizer why.
  const reasonRequired = decision !== "APPROVED";
  const reasonMissing = reasonRequired && notes.trim().length === 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (reasonMissing) {
      setShowReasonError(true);
      document.getElementById("review-notes")?.focus();
      return;
    }
    decideMutation.mutate();
  };

  const results = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  usePageClamp(Boolean(queueQuery.data), page, setPage, totalPages, (newPage) =>
    toast.message(`Moved to page ${newPage + 1} — no more results on the page you were viewing.`),
  );

  return (
    <AdminPageFrame
      title="Applications"
      description="Gate 1 — organizer application approval queue. Deciding here approves or rejects the organization's right to run this MUN; it does not review the MUN's content (see Verification)."
    >
      <div className="flex flex-wrap items-end gap-md">
        <div className="flex w-full max-w-md flex-col gap-xs">
          <label htmlFor="applications-search" className="text-body-md font-medium text-ink">
            Search
          </label>
          <div className="relative w-full">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="applications-search"
              type="search"
              placeholder="MUN name, organizer name or email"
              className="pl-xxl"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="applications-status">Status</Label>
          <select
            id="applications-status"
            className={adminSelectClassName}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ApplicationStatus);
              setPage(0);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-body-md text-muted-foreground">
          {total === 0 ? "No applications" : `${total} application${total === 1 ? "" : "s"}`}
        </p>
      </div>

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
          <p className="font-display text-title-md text-ink">
            {status === "SUBMITTED" ? "Nothing waiting on a decision." : "No applications match."}
          </p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            {search
              ? "Try a different name or email."
              : status === "SUBMITTED"
                ? "New organizer applications land here once they're submitted for review."
                : "Try a different status."}
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
                  <td className="px-md py-sm font-medium">
                    <Link to={`/admin/muns/${row.id}`} className="text-link hover:text-link-active">
                      {row.name}
                    </Link>
                  </td>
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
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>Review {reviewTarget?.name}</DialogTitle>
              <DialogDescription>
                Gate 1 decision — approves or rejects the organizing entity, not the MUN's content.
              </DialogDescription>
            </DialogHeader>

            {/* Only this middle section scrolls — the header and the footer's
                submit/cancel buttons stay on screen at any dialog height. */}
            <div className="flex min-h-0 flex-1 flex-col gap-lg overflow-y-auto">
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
                {detailQuery.data.startDate && (
                  <p>
                    <span className="text-muted-foreground">Expected start:</span>{" "}
                    {formatDate(detailQuery.data.startDate)}
                    {detailQuery.data.city ? ` · ${detailQuery.data.city}` : ""}
                  </p>
                )}
                {detailQuery.data.organizerApplication?.expectedDelegateCount != null && (
                  <p>
                    <span className="text-muted-foreground">Maximum expected delegates:</span>{" "}
                    {detailQuery.data.organizerApplication.expectedDelegateCount}
                  </p>
                )}
                {detailQuery.data.organizerApplication?.previousEditions && (
                  <p>
                    <span className="text-muted-foreground">Previous editions:</span>{" "}
                    {detailQuery.data.organizerApplication.previousEditions}
                  </p>
                )}
                {detailQuery.data.organizerApplication?.websiteUrl && (
                  <p>
                    <span className="text-muted-foreground">Website:</span>{" "}
                    <a
                      href={detailQuery.data.organizerApplication.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-link underline underline-offset-2"
                    >
                      {detailQuery.data.organizerApplication.websiteUrl}
                    </a>
                  </p>
                )}
                {detailQuery.data.description && (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">About:</span> {detailQuery.data.description}
                  </p>
                )}
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
                className="min-h-20 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 aria-invalid:border-destructive"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  if (event.target.value.trim()) setShowReasonError(false);
                }}
                required={reasonRequired}
                aria-invalid={showReasonError && reasonMissing ? true : undefined}
                aria-describedby={showReasonError && reasonMissing ? "review-notes-error" : undefined}
                placeholder={
                  decision === "APPROVED"
                    ? "Optional — shown to the organizer"
                    : "Required — what needs to change or why this was rejected"
                }
              />
              {showReasonError && reasonMissing && (
                <p id="review-notes-error" role="alert" className="text-body-md text-destructive">
                  {decision === "REJECTED"
                    ? "Give the organizer a reason for the rejection."
                    : "Tell the organizer what needs to change."}
                </p>
              )}
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
