import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardListIcon, SearchIcon } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { bulkApproveMunApplications, getMunForReview, getReviewQueue, reviewMunApplication } from "@/api/admin-review";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { OrganizerBankDetailsCard } from "@/components/admin/organizer-bank-details-card";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ORGANIZER_APPLICATION_FIELDS } from "@/lib/organizer-application-fields";
import type { ApplicationStatus, BulkApplicationDecisionResult, ReviewDecision, ReviewQueueRow } from "@/types/admin-review";

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; failed: BulkApplicationDecisionResult[] } | null>(
    null,
  );
  // Which fields to flag as needing correction — only sent/shown when
  // decision is CHANGES_REQUESTED. Cleared in closeDialog below.
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

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

  // Selection is page/filter-scoped: a row selected on one status/search/page
  // combination shouldn't silently carry over once the underlying result set
  // has changed under it.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkSummary(null);
  }, [status, search, page]);

  const closeDialog = () => {
    setReviewTarget(null);
    setNotes("");
    setInternalNotes("");
    setDecision("APPROVED");
    setShowReasonError(false);
    setSelectedFields(new Set());
  };

  const decideMutation = useMutation({
    mutationFn: () =>
      reviewMunApplication(reviewTarget!.id, {
        decision,
        notes: notes.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
        fieldsRequiringCorrection: decision === "CHANGES_REQUESTED" ? Array.from(selectedFields) : undefined,
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

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => bulkApproveMunApplications(ids),
    onSuccess: async (result) => {
      const failed = result.results.filter((r) => !r.ok);
      const ok = result.results.length - failed.length;
      setBulkSummary({ ok, failed });
      setSelectedIds(new Set());
      await refresh();
      if (failed.length === 0) {
        toast.success(`${ok} application${ok === 1 ? "" : "s"} approved`);
      } else if (ok === 0) {
        toast.error(`All ${failed.length} approvals failed`);
      } else {
        toast.warning(`${ok} approved, ${failed.length} failed`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to run the bulk approval"),
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

  const pageIds = results.map((row) => row.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

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

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-surface-soft/80 px-md py-sm">
          <p className="text-body-md font-medium text-ink">
            {selectedIds.size} selected
          </p>
          <div className="flex items-center gap-sm">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkApproveMutation.isPending}
            >
              Clear selection
            </Button>
            <Button
              size="sm"
              onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
              disabled={bulkApproveMutation.isPending}
            >
              {bulkApproveMutation.isPending ? "Approving..." : `Approve ${selectedIds.size}`}
            </Button>
          </div>
        </div>
      )}

      {bulkSummary && (
        <p role="status" className="text-body-md text-muted-foreground">
          {bulkSummary.ok} approved
          {bulkSummary.failed.length > 0
            ? `, ${bulkSummary.failed.length} failed: ${bulkSummary.failed
                .slice(0, 3)
                .map((f) => f.error ?? "Unknown error")
                .join("; ")}${bulkSummary.failed.length > 3 ? ` (+${bulkSummary.failed.length - 3} more)` : ""}`
            : ""}
        </p>
      )}

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
                <th className="w-10 px-md py-sm font-medium">
                  <Checkbox
                    aria-label="Select all applications on this page"
                    checked={allOnPageSelected}
                    onCheckedChange={toggleSelectAllOnPage}
                  />
                </th>
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
                  <td className="px-md py-sm">
                    <Checkbox
                      aria-label={`Select ${row.name}`}
                      checked={selectedIds.has(row.id)}
                      onCheckedChange={() => toggleRow(row.id)}
                    />
                  </td>
                  <td className="px-md py-sm font-medium">
                    <Link to={`/admin/muns/${row.id}`} className="text-link hover:text-link-active">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-md py-sm text-muted-foreground">
                    {[row.city, row.country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex flex-wrap items-center gap-xs">
                      <MunStatusBadge status={row.status} />
                      {row.resubmissionCount > 0 && (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-caption font-medium text-warning-text">
                          Resubmitted ({row.resubmissionCount})
                        </span>
                      )}
                    </div>
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
                        setSelectedFields(new Set());
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
              <DialogTitle className="flex flex-wrap items-center gap-sm">
                Review {reviewTarget?.name}
                {(detailQuery.data?.organizerApplication?.resubmissionCount ?? 0) > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-caption font-medium text-warning-text">
                    Resubmitted ({detailQuery.data!.organizerApplication!.resubmissionCount})
                  </span>
                )}
              </DialogTitle>
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
                {detailQuery.data.organizerProfile && (
                  <p>
                    <span className="text-muted-foreground">Organizer:</span>{" "}
                    {[detailQuery.data.organizerProfile.firstName, detailQuery.data.organizerProfile.lastName]
                      .filter(Boolean)
                      .join(" ") || "—"}
                    {detailQuery.data.organizerProfile.contactPhone
                      ? ` · ${detailQuery.data.organizerProfile.contactPhone}`
                      : ""}
                  </p>
                )}
                <p>
                  <span className="text-muted-foreground">Application submitted:</span>{" "}
                  {detailQuery.data.organizerApplication
                    ? formatDate(detailQuery.data.organizerApplication.submittedAt)
                    : "—"}
                </p>
                {detailQuery.data.organizerApplication?.fieldsRequiringCorrection &&
                  detailQuery.data.organizerApplication.fieldsRequiringCorrection.length > 0 && (
                    <p>
                      <span className="text-muted-foreground">Flagged for correction:</span>{" "}
                      {detailQuery.data.organizerApplication.fieldsRequiringCorrection
                        .map((key) => ORGANIZER_APPLICATION_FIELDS.find((f) => f.key === key)?.label ?? key)
                        .join(", ")}
                    </p>
                  )}
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

            {detailQuery.data && (
              <OrganizerBankDetailsCard key={detailQuery.data.organizerId} organizerId={detailQuery.data.organizerId} />
            )}

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

            {decision === "CHANGES_REQUESTED" && (
              <fieldset className="flex flex-col gap-xs">
                <legend className="text-body-md font-medium text-ink">Fields that need correction</legend>
                <p className="text-body-md text-muted-foreground">
                  Shown to the organizer on the resubmit form — optional, in addition to the note above.
                </p>
                <div className="flex flex-col gap-xs">
                  {ORGANIZER_APPLICATION_FIELDS.map((field) => (
                    <label key={field.key} className="flex items-center gap-sm text-body-md text-body">
                      <Checkbox
                        checked={selectedFields.has(field.key)}
                        onCheckedChange={(checked) =>
                          setSelectedFields((prev) => {
                            const next = new Set(prev);
                            if (checked === true) next.add(field.key);
                            else next.delete(field.key);
                            return next;
                          })
                        }
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

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
