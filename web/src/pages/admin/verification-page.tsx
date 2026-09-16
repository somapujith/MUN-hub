import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { getModuleReviewQueue, reviewModule } from "@/api/module-verification";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
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
import { MODULE_LABELS, SEVERITY_OPTIONS } from "@/lib/admin/module-labels";
import type { ModuleReviewDecision, ModuleReviewQueueRow, VerificationIssueInput } from "@/types/module-verification";

const PAGE_SIZE = 20;

const DECISION_OPTIONS: Array<{ value: ModuleReviewDecision; label: string }> = [
  { value: "VERIFIED", label: "Verify" },
  { value: "CHANGES_REQUESTED", label: "Request changes" },
  { value: "REJECTED", label: "Reject" },
];

const EMPTY_ISSUE: VerificationIssueInput = { severity: "MEDIUM", reason: "" };

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Gate 2 — MUN-content review ("is this MUN's content correct enough to
 * publish"), at module granularity. Wraps `getModuleReviewQueue` /
 * `reviewModule` (lib/lifecycle/module-verification.ts). This is NEVER the
 * organizer-application approval gate — see `AdminReviewPage` for that
 * (Gate 1, whole-mun, a completely different table and action). A module
 * `VERIFIED` decision here can auto-advance the mun's overall status once
 * every required module has passed (`checkAllModulesVerified`), but this
 * page never touches `muns.status` directly.
 */
export function AdminVerificationPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [reviewTarget, setReviewTarget] = useState<ModuleReviewQueueRow | null>(null);
  const [decision, setDecision] = useState<ModuleReviewDecision>("VERIFIED");
  const [issues, setIssues] = useState<VerificationIssueInput[]>([]);

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const queueQuery = useQuery({
    queryKey: queryKeys.adminModuleReviewQueue(params),
    queryFn: () => getModuleReviewQueue(params),
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "module-review-queue"] });

  const closeDialog = () => {
    setReviewTarget(null);
    setDecision("VERIFIED");
    setIssues([]);
  };

  const decideMutation = useMutation({
    mutationFn: () =>
      reviewModule(reviewTarget!.munId, reviewTarget!.moduleName, {
        decision,
        issues: issues
          .filter((issue) => issue.reason.trim().length > 0)
          .map((issue) => ({
            ...issue,
            reason: issue.reason.trim(),
            previousValue: issue.previousValue?.trim() || undefined,
            newValue: issue.newValue?.trim() || undefined,
          })),
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(
        decision === "VERIFIED"
          ? "Module verified"
          : decision === "REJECTED"
            ? "Module rejected"
            : "Changes requested from organizer",
      );
      closeDialog();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record decision"),
  });

  const requiresIssues = decision !== "VERIFIED";
  const validIssueCount = issues.filter((issue) => issue.reason.trim().length > 0).length;
  const canSubmit = !requiresIssues || validIssueCount > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      toast.error("At least one issue with a reason is required for this decision");
      return;
    }
    decideMutation.mutate();
  };

  const addIssue = () => setIssues((prev) => [...prev, { ...EMPTY_ISSUE }]);
  const removeIssue = (index: number) => setIssues((prev) => prev.filter((_, i) => i !== index));
  const updateIssue = (index: number, patch: Partial<VerificationIssueInput>) =>
    setIssues((prev) => prev.map((issue, i) => (i === index ? { ...issue, ...patch } : issue)));

  const results = queueQuery.data?.results ?? [];
  const total = queueQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminPageFrame
      title="Verification"
      description="Gate 2 — module-level content-verification console. Deciding here checks whether one part of a MUN's content is accurate enough to publish; it does not decide whether the organizer is approved to run a MUN (see Applications)."
    >
      {queueQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : queueQuery.isError ? (
        <p className="text-body-md text-destructive">
          {queueQuery.error instanceof Error
            ? queueQuery.error.message
            : "Unable to load the verification queue right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <ShieldCheckIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">No modules pending review.</p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            Modules land here once an organizer confirms them for review.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[40rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">MUN</th>
                <th className="px-md py-sm font-medium">Module</th>
                <th className="px-md py-sm font-medium">Confirmed</th>
                <th className="px-md py-sm font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-md py-sm font-medium text-ink">{row.munName}</td>
                  <td className="px-md py-sm text-muted-foreground">{MODULE_LABELS[row.moduleName] ?? row.moduleName}</td>
                  <td className="px-md py-sm tabular-nums text-muted-foreground">
                    {formatDate(row.organizerConfirmedAt)}
                  </td>
                  <td className="px-md py-sm text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReviewTarget(row);
                        setDecision("VERIFIED");
                        setIssues([]);
                      }}
                    >
                      Review module
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>
                {reviewTarget && (MODULE_LABELS[reviewTarget.moduleName] ?? reviewTarget.moduleName)} — {reviewTarget?.munName}
              </DialogTitle>
              <DialogDescription>
                Gate 2 decision — verifies this module's content only, not the organizer's overall application.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="module-decision">Decision</Label>
              <select
                id="module-decision"
                className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                value={decision}
                onChange={(event) => setDecision(event.target.value as ModuleReviewDecision)}
              >
                {DECISION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-sm">
              <div className="flex items-center justify-between">
                <Label>
                  Issues {requiresIssues && <span className="text-destructive">(at least one required)</span>}
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addIssue}>
                  <PlusIcon aria-hidden /> Add issue
                </Button>
              </div>

              {issues.length === 0 && (
                <p className="text-body-md text-muted-foreground">No issues added.</p>
              )}

              {issues.map((issue, index) => (
                <div key={index} className="flex flex-col gap-xs rounded-md border border-border p-md">
                  <div className="flex items-center gap-xs">
                    <select
                      aria-label={`Severity for issue ${index + 1}`}
                      className="h-9 rounded-sm border border-input bg-background px-sm text-body-md text-ink"
                      value={issue.severity}
                      onChange={(event) =>
                        updateIssue(index, { severity: event.target.value as VerificationIssueInput["severity"] })
                      }
                    >
                      {SEVERITY_OPTIONS.map((severity) => (
                        <option key={severity} value={severity}>
                          {severity}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove issue ${index + 1}`}
                      onClick={() => removeIssue(index)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                  <Input
                    aria-label={`Reason for issue ${index + 1}`}
                    placeholder="What's wrong with this module's content?"
                    value={issue.reason}
                    onChange={(event) => updateIssue(index, { reason: event.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-xs">
                    <Input
                      aria-label={`Previous value for issue ${index + 1}`}
                      placeholder="Previous value (optional)"
                      value={issue.previousValue ?? ""}
                      onChange={(event) => updateIssue(index, { previousValue: event.target.value })}
                    />
                    <Input
                      aria-label={`Expected value for issue ${index + 1}`}
                      placeholder="Expected value (optional)"
                      value={issue.newValue ?? ""}
                      onChange={(event) => updateIssue(index, { newValue: event.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant={decision === "REJECTED" ? "destructive" : "default"}
                disabled={decideMutation.isPending || !canSubmit}
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
