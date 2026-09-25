import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, CheckCircle2, Eye, Globe, LockIcon, Rocket, Save, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import {
  getMunProgress,
  getMunReviewFeedback,
  organizerSelfPublish,
  submitMunForReview,
  withdrawSubmission,
} from "@/api/go-live";
import { getMunDetails, updateMunDetails } from "@/api/mun-config";
import { getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { submitFinalConfirmation } from "@/api/organizer-confirmation";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { FinalConfirmationCard } from "@/components/organizer/go-live/final-confirmation-card";
import { GoLiveChecklist } from "@/components/organizer/go-live/go-live-checklist";
import { ReviewFeedbackCard } from "@/components/organizer/go-live/review-feedback-card";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { getStatusMeta } from "@/lib/mun-status";
import {
  LIVE_STATUSES,
  MODULE_SECTION,
  POST_APPROVAL_STATUSES,
  hasReviewFeedback,
  isUnderReview,
} from "@/lib/organizer/go-live";
import { munSectionHref } from "@/lib/organizer/nav-config";
import type { MunModule, MunStatus } from "@/types/enums";
import type { SubmitMunForReviewResult } from "@/types/go-live";
import type { MunSetupDetails } from "@/types/mun-config";

// Mirrors lib/lifecycle/go-live.ts's SUBMITTABLE_STATUSES /
// lib/lifecycle/organizer-confirmation.ts's CONFIRMABLE_STATUSES exactly —
// UI-only enablement hints, not a security boundary. The server re-checks
// both independently and rejects an illegal transition regardless of what
// this page renders.
const SUBMITTABLE_STATUSES = ["ONBOARDING", "ACTION_REQUIRED", "READY_FOR_SUBMISSION", "CONTENT_SUBMITTED"];
const CONFIRMABLE_STATUSES = ["CONTENT_SUBMITTED", "ORGANIZER_CONFIRMATION"];

interface SetupForm {
  name: string;
  edition: string;
  theme: string;
  description: string;
  startDate: string;
  endDate: string;
  venue: string;
  addressLine1: string;
  city: string;
  addressState: string;
  postalCode: string;
  country: string;
  mapUrl: string;
  registrationOpensAt: string;
  registrationDeadline: string;
}

const TEXTAREA_CLASS =
  "min-h-32 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** ISO timestamp → the local "YYYY-MM-DDTHH:mm" a datetime-local input shows. */
function toDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** The datetime-local value is in the organizer's own timezone. */
function fromDateTimeInputValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formFromMun(mun: MunSetupDetails): SetupForm {
  return {
    name: mun.name,
    edition: mun.edition ?? "",
    theme: mun.theme ?? "",
    description: mun.description ?? "",
    startDate: toDateInputValue(mun.startDate),
    endDate: toDateInputValue(mun.endDate),
    venue: mun.venue ?? "",
    addressLine1: mun.addressLine1 ?? "",
    city: mun.city ?? "",
    addressState: mun.addressState ?? "",
    postalCode: mun.postalCode ?? "",
    country: mun.country ?? "",
    mapUrl: mun.mapUrl ?? "",
    registrationOpensAt: toDateTimeInputValue(mun.registrationOpensAt),
    registrationDeadline: toDateTimeInputValue(mun.registrationDeadline),
  };
}

/** Same ordering rules the API enforces, checked before saving. */
function validateForm(form: SetupForm): string | null {
  if (!form.name.trim()) return "Conference name is required";
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    return "End date can't be before the start date";
  }
  if (form.mapUrl.trim() && !/^https?:\/\//i.test(form.mapUrl.trim())) {
    return "Map link must be a full URL, including https://";
  }
  const opens = form.registrationOpensAt ? new Date(form.registrationOpensAt).getTime() : null;
  const closes = form.registrationDeadline ? new Date(form.registrationDeadline).getTime() : null;
  if (opens !== null && closes !== null && closes <= opens) {
    return "Registration deadline must be after registration opens";
  }
  if (closes !== null && form.startDate && closes >= new Date(`${form.startDate}T00:00`).getTime()) {
    return "Registration deadline must be before the conference starts";
  }
  return null;
}

export function OrganizerSetupPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
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
  const feedbackQuery = useQuery({
    queryKey: queryKeys.munReviewFeedback(munId),
    queryFn: () => getMunReviewFeedback(munId),
    enabled: Boolean(munId),
  });
  // Same query key the workspace-wide payout banner and Quick Setup use —
  // shares one cache entry rather than firing a second request.
  const onboardingQuery = useQuery({
    queryKey: queryKeys.organizerOnboarding(),
    queryFn: getOrganizerOnboarding,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.munSetupDetails(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munReviewFeedback(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munConfirmationPreview(munId) }),
      // The workspace list carries the status the review lock banner reads.
      queryClient.invalidateQueries({ queryKey: queryKeys.organizerWorkspace() }),
    ]);

  const submitForReviewMutation = useMutation({
    mutationFn: () => submitMunForReview(munId),
    onSuccess: async (result) => {
      setLastReview(result);
      await refresh();
      if (result.passed) {
        toast.success("Automated checks passed. Confirm your submission to send it to MUN Hub.");
      } else {
        toast.error(`Automated checks found ${result.blockers.length} thing(s) to fix`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to submit for review"),
  });

  const confirmMutation = useMutation({
    mutationFn: () => submitFinalConfirmation(munId, true),
    onSuccess: async () => {
      setLastReview(null);
      await refresh();
      toast.success("Confirmed. MUN Hub is now verifying your MUN.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to confirm submission"),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawSubmission(munId),
    onSuccess: async () => {
      setLastReview(null);
      await refresh();
      toast.success("Your sections are unlocked. Run the checks again when you're ready.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to unlock your sections"),
  });

  const selfPublishMutation = useMutation({
    mutationFn: () => organizerSelfPublish(munId),
    onSuccess: async (result) => {
      await refresh();
      toast.success(`${result.mun.name} is now live on MUN Hub.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to publish your MUN"),
  });

  const mun = detailsQuery.data;
  const progress = progressQuery.data;
  const status: MunStatus | undefined = progress?.lifecycleStatus ?? mun?.status;
  const payoutVerified = onboardingQuery.data?.profile.payoutVerified ?? false;
  const canSubmitForReview = Boolean(status && SUBMITTABLE_STATUSES.includes(status));
  const canConfirm = Boolean(status && CONFIRMABLE_STATUSES.includes(status));
  const approved = Boolean(status && POST_APPROVAL_STATUSES.includes(status));
  const live = Boolean(status && LIVE_STATUSES.includes(status));
  // The API unlocks whichever of these two a reviewer sent back.
  const detailsSentBack =
    progress?.modules.some(
      (module) =>
        (module.key === "BASIC_INFO" || module.key === "DATES_VENUE") && module.verificationState === "CHANGES_REQUESTED",
    ) ?? false;
  const detailsLocked = Boolean(status && isUnderReview(status)) && !detailsSentBack;
  const feedback = feedbackQuery.data;
  // Once approved, old notes only matter if an issue is still open.
  const showFeedback =
    hasReviewFeedback(feedback) && (!approved || feedback.issues.some((issue) => !issue.resolved));
  const nextModule = progress?.modules.find((module) => module.isRequired && module.completionStatus !== "COMPLETE" && module.completionStatus !== "LOCKED");
  const nextSegment = nextModule ? MODULE_SECTION[nextModule.key as MunModule] : undefined;

  return (
    <>
      <Helmet title="MUN Setup" />
      <WorkspacePage
        title="MUN Setup"
        description="Your conference's core record — how it's named, when it runs, and where delegates are going."
        actions={
          mun && (
            <>
              <MunStatusBadge status={mun.status} />
              <Button
                size="sm"
                variant="outline"
                render={<Link to={`/organizer/muns/${munId}/preview`} target="_blank" rel="noopener" />}
              >
                <Eye aria-hidden />
                Preview as a delegate
              </Button>
            </>
          )
        }
      >
        {detailsQuery.isLoading ? (
          <Skeleton className="h-[420px] w-full rounded-md" />
        ) : detailsQuery.isError ? (
          <p className="text-body-md text-destructive">{detailsQuery.error.message}</p>
        ) : (
          <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-lg">
              {canConfirm && (
                <FinalConfirmationCard
                  munId={munId}
                  confirming={confirmMutation.isPending}
                  onConfirm={() => confirmMutation.mutate()}
                  withdrawing={withdrawMutation.isPending}
                  onWithdraw={() => withdrawMutation.mutate()}
                />
              )}

              {showFeedback && feedback && <ReviewFeedbackCard munId={munId} feedback={feedback} />}

              {mun && (
                // Remounts with fresh values whenever the saved record changes.
                <ConferenceDetailsForm
                  key={mun.updatedAt}
                  munId={munId}
                  mun={mun}
                  locked={detailsLocked}
                  onSaved={refresh}
                />
              )}

              {progress && !approved && <GoLiveChecklist munId={munId} modules={progress.modules} />}
            </div>

            {/* First on small screens: where you are and what's next, before the long form. */}
            <aside className="order-first flex flex-col gap-md xl:order-none">
              {!approved && (
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>Go-live progress</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-sm">
                    {progressQuery.isLoading && (
                      <p className="text-body-md text-muted-foreground">Checking your sections...</p>
                    )}
                    {progressQuery.isError && (
                      <p className="text-body-md text-destructive">{progressQuery.error.message}</p>
                    )}
                    {progress && (
                      <>
                        <p className="text-body-md text-body">
                          Status:{" "}
                          <span className="font-medium text-ink">{getStatusMeta(progress.lifecycleStatus).label}</span>
                        </p>
                        <div
                          className="h-2 w-full overflow-hidden rounded-full bg-surface-soft"
                          role="progressbar"
                          aria-label="Required sections complete"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress.overallPercentage}
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{ width: `${Math.min(100, Math.max(0, progress.overallPercentage))}%` }}
                          />
                        </div>
                        <p className="text-caption text-muted-foreground">
                          {progress.requiredComplete} of {progress.requiredTotal} required sections complete
                        </p>
                        {progress.blockingIssueCount > 0 && (
                          <p className="flex items-center gap-xs text-body-md text-warning-text">
                            <AlertTriangle className="size-4" aria-hidden />
                            {progress.blockingIssueCount === 1
                              ? "1 blocking issue to fix"
                              : `${progress.blockingIssueCount} blocking issues to fix`}
                          </p>
                        )}
                        {canSubmitForReview && nextModule && (
                          <p className="text-body-md text-body" data-testid="next-section">
                            Next up:{" "}
                            {nextSegment && nextSegment !== "setup" ? (
                              <Link
                                to={munSectionHref(munId, nextSegment)}
                                className="font-medium text-link underline-offset-2 hover:underline"
                              >
                                {nextModule.label}
                              </Link>
                            ) : (
                              <a href="#go-live-checklist-title" className="font-medium text-link underline-offset-2 hover:underline">
                                {nextModule.label}
                              </a>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card size="sm" data-testid="go-live-status">
                <CardHeader>
                  <CardTitle>
                    {live ? "Your MUN is live" : approved ? "Approved" : canSubmitForReview ? "Submit for review" : "In review"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-sm">
                  {canSubmitForReview && (
                    <>
                      <ol className="flex list-decimal flex-col gap-xxs pl-md text-body-md text-muted-foreground">
                        <li>Run MUN Hub&apos;s automated checks on every section.</li>
                        <li>Review the summary and confirm it&apos;s accurate.</li>
                        <li>MUN Hub verifies each section and emails you the result.</li>
                      </ol>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submitForReviewMutation.isPending}
                        onClick={() => submitForReviewMutation.mutate()}
                      >
                        <ShieldCheck aria-hidden />
                        {submitForReviewMutation.isPending ? "Checking..." : "Run checks and submit"}
                      </Button>
                      {lastReview && !lastReview.passed && (
                        <ul className="flex flex-col gap-xxs rounded-sm border border-destructive/30 bg-destructive/10 p-sm text-caption text-destructive-text">
                          {lastReview.blockers.map((blocker) => (
                            <li key={blocker.key}>{blocker.message ?? blocker.label}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {canConfirm && (
                    <p className="flex items-center gap-xs text-body-md text-success-text">
                      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                      Checks passed. Confirm your submission to continue.
                    </p>
                  )}
                  {status === "VERIFICATION" && payoutVerified && (
                    <>
                      <p className="flex items-center gap-xs text-body-md text-success-text">
                        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                        Your payout is verified — you can publish this MUN yourself, no admin review needed.
                      </p>
                      <Button
                        size="sm"
                        disabled={selfPublishMutation.isPending}
                        onClick={() => selfPublishMutation.mutate()}
                      >
                        <Rocket aria-hidden />
                        {selfPublishMutation.isPending ? "Publishing..." : "Go live"}
                      </Button>
                    </>
                  )}
                  {status === "VERIFICATION" && !payoutVerified && (
                    <p className="text-body-md text-body">
                      MUN Hub is verifying your MUN and will email you the result. Sections they send back show up
                      in the checklist below, unlocked for you to fix. Waiting on payment verification before this
                      can go live — once that's done, you can publish it yourself.
                    </p>
                  )}
                  {approved && !live && (
                    <p className="flex items-center gap-xs text-body-md text-success-text">
                      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                      MUN Hub approved your MUN and will publish it shortly.
                    </p>
                  )}
                  {live && mun && (
                    <>
                      <p className="text-body-md text-body">
                        Delegates can find {mun.name} on MUN Hub. Open or close registration from Settings.
                      </p>
                      <div className="flex flex-wrap gap-xs">
                        <Button size="sm" variant="outline" render={<Link to={`/mun/${mun.slug}`} />}>
                          <Globe aria-hidden />
                          View public page
                        </Button>
                        <Button size="sm" variant="outline" render={<Link to={munSectionHref(munId, "settings")} />}>
                          Registration settings
                        </Button>
                      </div>
                      <p className="text-caption text-muted-foreground">
                        You can keep editing your MUN after it's live, and changes appear on the site straight away.
                        If you change payout details, MUN Hub re-checks the account.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </WorkspacePage>
    </>
  );
}

function ConferenceDetailsForm({
  munId,
  mun,
  locked,
  onSaved,
}: {
  munId: string;
  mun: MunSetupDetails;
  locked: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<SetupForm>(() => formFromMun(mun));

  const set = (field: keyof SetupForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const saveMutation = useMutation({
    mutationFn: () => {
      const text = (value: string) => value.trim() || null;
      return updateMunDetails(munId, {
        name: form.name.trim(),
        edition: text(form.edition),
        theme: text(form.theme),
        description: text(form.description),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        venue: text(form.venue),
        addressLine1: text(form.addressLine1),
        city: text(form.city),
        addressState: text(form.addressState),
        postalCode: text(form.postalCode),
        country: text(form.country),
        mapUrl: text(form.mapUrl),
        registrationOpensAt: fromDateTimeInputValue(form.registrationOpensAt),
        registrationDeadline: fromDateTimeInputValue(form.registrationDeadline),
      });
    },
    onSuccess: async () => {
      await onSaved();
      toast.success("Conference details saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save details"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conference details</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validateForm(form);
            if (problem) {
              toast.error(problem);
              return;
            }
            saveMutation.mutate();
          }}
        >
          {locked && (
            <p className="flex items-center gap-xs rounded-sm bg-surface-soft px-sm py-xs text-body-md text-body">
              <LockIcon className="size-4 shrink-0" aria-hidden />
              These details are locked while MUN Hub reviews your MUN. They unlock once the review finishes, or
              right away if a reviewer asks you to change them.
            </p>
          )}
          <fieldset disabled={locked} className="flex min-w-0 flex-col gap-md">
            <div className="grid gap-md sm:grid-cols-2">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-name">Conference name</Label>
                <Input id="setup-name" value={form.name} onChange={set("name")} required />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-edition">Edition</Label>
                <Input id="setup-edition" placeholder="e.g. 2027" value={form.edition} onChange={set("edition")} />
              </div>
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="setup-theme">Theme</Label>
              <Input id="setup-theme" value={form.theme} onChange={set("theme")} />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="setup-description">Description</Label>
              <textarea
                id="setup-description"
                className={TEXTAREA_CLASS}
                value={form.description}
                onChange={set("description")}
              />
            </div>
            <div className="grid gap-md sm:grid-cols-2">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-start-date">Start date</Label>
                <Input id="setup-start-date" type="date" value={form.startDate} onChange={set("startDate")} />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-end-date">End date</Label>
                <Input id="setup-end-date" type="date" value={form.endDate} onChange={set("endDate")} />
              </div>
            </div>

            <h3 className="mt-xs text-body-md font-medium text-ink">Where it happens</h3>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="setup-venue">Venue</Label>
              <Input
                id="setup-venue"
                placeholder="e.g. Convention Centre, Hall B"
                value={form.venue}
                onChange={set("venue")}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="setup-address">Address line</Label>
              <Input
                id="setup-address"
                autoComplete="street-address"
                placeholder="Building, street and area"
                value={form.addressLine1}
                onChange={set("addressLine1")}
              />
            </div>
            <div className="grid gap-md sm:grid-cols-2">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-city">City</Label>
                <Input id="setup-city" autoComplete="address-level2" value={form.city} onChange={set("city")} />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-state">State</Label>
                <Input
                  id="setup-state"
                  autoComplete="address-level1"
                  value={form.addressState}
                  onChange={set("addressState")}
                />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-postal-code">Postal code</Label>
                <Input
                  id="setup-postal-code"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  value={form.postalCode}
                  onChange={set("postalCode")}
                />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-country">Country</Label>
                <Input id="setup-country" autoComplete="country-name" value={form.country} onChange={set("country")} />
              </div>
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="setup-map-url">Map link</Label>
              <Input
                id="setup-map-url"
                type="url"
                placeholder="https://maps.google.com/..."
                value={form.mapUrl}
                onChange={set("mapUrl")}
              />
            </div>

            <h3 className="mt-xs text-body-md font-medium text-ink">Registration window</h3>
            <div className="grid gap-md sm:grid-cols-2">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-registration-opens">Registration opens</Label>
                <Input
                  id="setup-registration-opens"
                  type="datetime-local"
                  value={form.registrationOpensAt}
                  onChange={set("registrationOpensAt")}
                />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="setup-registration-deadline">Registration closes</Label>
                <Input
                  id="setup-registration-deadline"
                  type="datetime-local"
                  value={form.registrationDeadline}
                  onChange={set("registrationDeadline")}
                />
              </div>
            </div>
            <p className="text-caption text-muted-foreground">
              Delegates can register only inside this window. It must close before the conference starts.
            </p>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                <Save aria-hidden />
                {saveMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
