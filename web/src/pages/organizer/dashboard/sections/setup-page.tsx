import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, CheckCircle2, Save, ShieldCheck } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { getMunProgress, submitMunForReview } from "@/api/go-live";
import { getMunDetails, updateMunDetails } from "@/api/mun-config";
import { submitFinalConfirmation } from "@/api/organizer-confirmation";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { UpdateMunDetailsInput } from "@/types/mun-config";
import type { SubmitMunForReviewResult } from "@/types/go-live";

// Mirrors lib/lifecycle/go-live.ts's SUBMITTABLE_STATUSES /
// lib/lifecycle/organizer-confirmation.ts's CONFIRMABLE_STATUSES exactly —
// UI-only enablement hints, not a security boundary. The server re-checks
// both independently and rejects an illegal transition regardless of what
// this page renders.
const SUBMITTABLE_STATUSES = ["ONBOARDING", "ACTION_REQUIRED", "READY_FOR_SUBMISSION", "CONTENT_SUBMITTED"];
const CONFIRMABLE_STATUSES = ["CONTENT_SUBMITTED", "ORGANIZER_CONFIRMATION"];

const EMPTY_FORM: UpdateMunDetailsInput = {
  name: "",
  edition: "",
  theme: "",
  description: "",
  startDate: "",
  endDate: "",
  venue: "",
  city: "",
  country: "",
};

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function OrganizerSetupPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UpdateMunDetailsInput>(EMPTY_FORM);
  const [lastReview, setLastReview] = useState<SubmitMunForReviewResult | null>(null);

  const detailsQuery = useQuery({
    queryKey: queryKeys.munSetupDetails(munId),
    queryFn: () => getMunDetails(munId),
    enabled: Boolean(munId),
  });
  const progressQuery = useQuery({
    queryKey: queryKeys.munProgress(munId),
    queryFn: () => getMunProgress(munId),
    enabled: Boolean(munId),
  });

  useEffect(() => {
    const mun = detailsQuery.data;
    if (!mun) return;
    setForm({
      name: mun.name,
      edition: mun.edition ?? "",
      theme: mun.theme ?? "",
      description: mun.description ?? "",
      startDate: toDateInputValue(mun.startDate),
      endDate: toDateInputValue(mun.endDate),
      venue: mun.venue ?? "",
      city: mun.city ?? "",
      country: mun.country ?? "",
    });
  }, [detailsQuery.data]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.munSetupDetails(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
    ]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateMunDetails(munId, {
        ...form,
        edition: form.edition || null,
        theme: form.theme || null,
        description: form.description || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        venue: form.venue || null,
        city: form.city || null,
        country: form.country || null,
      }),
    onSuccess: async () => {
      await refresh();
      toast.success("Conference details saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save details"),
  });

  const submitForReviewMutation = useMutation({
    mutationFn: () => submitMunForReview(munId),
    onSuccess: async (result) => {
      setLastReview(result);
      await refresh();
      if (result.passed) {
        toast.success("Submitted — automated validation passed");
      } else {
        toast.error(`Automated validation found ${result.blockers.length} blocking issue(s)`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to submit for review"),
  });

  const confirmMutation = useMutation({
    mutationFn: () => submitFinalConfirmation(munId),
    onSuccess: async () => {
      await refresh();
      toast.success("Confirmed — sent to MUNHub for verification");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to confirm submission"),
  });

  const mun = detailsQuery.data;
  const progress = progressQuery.data;
  const canSubmitForReview = Boolean(progress && SUBMITTABLE_STATUSES.includes(progress.lifecycleStatus));
  const canConfirm = Boolean(progress && CONFIRMABLE_STATUSES.includes(progress.lifecycleStatus));

  return (
    <>
      <Helmet title="MUN Setup" />
      <WorkspacePage
        title="MUN Setup"
        description="Your conference's core record — how it's named, when it runs, and where delegates are going."
        actions={mun && <MunStatusBadge status={mun.status} />}
      >
        {detailsQuery.isLoading ? (
          <Skeleton className="h-[420px] w-full rounded-md" />
        ) : detailsQuery.isError ? (
          <p className="text-body-md text-destructive">{detailsQuery.error.message}</p>
        ) : (
          <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card>
              <CardHeader>
                <CardTitle>Conference details</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-md"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!form.name?.trim()) {
                      toast.error("Conference name is required");
                      return;
                    }
                    saveMutation.mutate();
                  }}
                >
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="setup-name">Conference name</Label>
                      <Input
                        id="setup-name"
                        value={form.name ?? ""}
                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="setup-edition">Edition</Label>
                      <Input
                        id="setup-edition"
                        placeholder="e.g. 2027"
                        value={form.edition ?? ""}
                        onChange={(event) => setForm({ ...form, edition: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="setup-theme">Theme</Label>
                    <Input
                      id="setup-theme"
                      value={form.theme ?? ""}
                      onChange={(event) => setForm({ ...form, theme: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="setup-description">Description</Label>
                    <textarea
                      id="setup-description"
                      className="min-h-32 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                      value={form.description ?? ""}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="setup-start-date">Start date</Label>
                      <Input
                        id="setup-start-date"
                        type="date"
                        value={form.startDate ?? ""}
                        onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="setup-end-date">End date</Label>
                      <Input
                        id="setup-end-date"
                        type="date"
                        value={form.endDate ?? ""}
                        onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="setup-venue">Venue</Label>
                    <Input
                      id="setup-venue"
                      value={form.venue ?? ""}
                      onChange={(event) => setForm({ ...form, venue: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="setup-city">City</Label>
                      <Input
                        id="setup-city"
                        value={form.city ?? ""}
                        onChange={(event) => setForm({ ...form, city: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="setup-country">Country</Label>
                      <Input
                        id="setup-country"
                        value={form.country ?? ""}
                        onChange={(event) => setForm({ ...form, country: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                      <Save aria-hidden />
                      {saveMutation.isPending ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <aside className="flex flex-col gap-md">
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Go-live progress</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-sm">
                  {progressQuery.isLoading && (
                    <p className="text-body-md text-muted-foreground">Loading progress...</p>
                  )}
                  {progressQuery.isError && (
                    <p className="text-body-md text-destructive">{progressQuery.error.message}</p>
                  )}
                  {progress && (
                    <>
                      <p className="text-body-md text-body">
                        Status: <span className="font-medium text-ink">{progress.lifecycleStatusLabel}</span>
                      </p>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-soft">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${Math.min(100, Math.max(0, progress.overallPercentage))}%` }}
                        />
                      </div>
                      <p className="text-caption text-muted-foreground">
                        {progress.requiredComplete}/{progress.requiredTotal} required modules complete
                      </p>
                      {progress.blockingIssueCount > 0 && (
                        <p className="flex items-center gap-xs text-body-md text-warning-text">
                          <AlertTriangle className="size-4" aria-hidden />
                          {progress.blockingIssueCount} blocking issue(s) across modules
                        </p>
                      )}
                      <ul className="mt-xs flex flex-col gap-xxs">
                        {progress.modules.map((module) => (
                          <li
                            key={module.key}
                            className="flex items-center justify-between gap-sm text-caption text-muted-foreground"
                          >
                            <span className="text-body text-ink">{module.label}</span>
                            <span>
                              {module.completionStatus}
                              {module.blockingIssueCount > 0 ? ` · ${module.blockingIssueCount} issue(s)` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Submit for review</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-sm">
                  <p className="text-body-md text-muted-foreground">
                    Runs MUNHub's automated checks across every module, then opens your review window.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canSubmitForReview || submitForReviewMutation.isPending}
                    onClick={() => submitForReviewMutation.mutate()}
                  >
                    <ShieldCheck aria-hidden />
                    {submitForReviewMutation.isPending ? "Validating..." : "Submit for review"}
                  </Button>
                  {lastReview && !lastReview.passed && (
                    <ul className="flex flex-col gap-xxs rounded-sm border border-destructive/30 bg-destructive/10 p-sm text-caption text-destructive-text">
                      {lastReview.blockers.map((blocker) => (
                        <li key={blocker.key}>{blocker.message ?? blocker.label}</li>
                      ))}
                    </ul>
                  )}
                  {lastReview?.passed && (
                    <p className="flex items-center gap-xs text-body-md text-success-text">
                      <CheckCircle2 className="size-4" aria-hidden />
                      Automated validation passed
                    </p>
                  )}
                  <hr className="border-border" />
                  <p className="text-body-md text-muted-foreground">
                    Once validation passes, confirm your submission is accurate and complete to send it to MUNHub
                    for verification.
                  </p>
                  <Button
                    size="sm"
                    disabled={!canConfirm || confirmMutation.isPending}
                    onClick={() => confirmMutation.mutate()}
                  >
                    <CheckCircle2 aria-hidden />
                    {confirmMutation.isPending ? "Confirming..." : "Confirm & send for verification"}
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </WorkspacePage>
    </>
  );
}
