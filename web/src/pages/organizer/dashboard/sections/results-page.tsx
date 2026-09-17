import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Award, CircleCheck, Lock, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { getDelegateList } from "@/api/organizer-dashboard";
import {
  createAchievement,
  deleteAchievement,
  getResultsState,
  listMunAchievements,
  resultsKeys,
  submitResultsForReview,
} from "@/api/results";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { CreateAchievementInput, ResultsState } from "@/types/results";

const EMPTY_FORM: CreateAchievementInput = {
  registrationId: "",
  committee: "",
  portfolio: "",
  award: "",
};

// The picker searches the roster server-side, so it never needs the whole
// delegate list; this is the most matches it shows at once.
const DELEGATE_PICKER_LIMIT = 50;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Results & Awards: record awards by hand for confirmed or checked-in
 * delegates, then submit them to MUNHub for review (lib/actions/results.ts).
 * Awards are locked while under review and once approved.
 */
export function OrganizerResultsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<CreateAchievementInput>(EMPTY_FORM);
  const [delegateSearch, setDelegateSearch] = useState("");
  const debouncedSearch = useDebouncedValue(delegateSearch.trim(), 300);

  const achievementsQuery = useQuery({
    queryKey: resultsKeys.achievements(munId),
    queryFn: () => listMunAchievements(munId),
    enabled: Boolean(munId),
  });
  const stateQuery = useQuery({
    queryKey: resultsKeys.state(munId),
    queryFn: () => getResultsState(munId),
    enabled: Boolean(munId),
  });
  const delegatesQuery = useQuery({
    queryKey: ["organizer", "delegates", munId, "award-picker", debouncedSearch],
    queryFn: () =>
      getDelegateList(munId, {
        statuses: ["CONFIRMED", "ATTENDED"],
        search: debouncedSearch || undefined,
        limit: DELEGATE_PICKER_LIMIT,
      }),
    enabled: Boolean(munId) && isFormOpen,
    placeholderData: (previous) => previous,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: resultsKeys.achievements(munId) }),
      queryClient.invalidateQueries({ queryKey: resultsKeys.state(munId) }),
    ]);

  const createMutation = useMutation({
    mutationFn: () => createAchievement(munId, form),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setForm(EMPTY_FORM);
      setDelegateSearch("");
      toast.success("Award recorded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record award"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAchievement,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete award"),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitResultsForReview(munId),
    onSuccess: async (state) => {
      queryClient.setQueryData(resultsKeys.state(munId), state);
      await queryClient.invalidateQueries({ queryKey: ["organizer", "workspace"] });
      toast.success("Results submitted for review");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to submit results"),
  });

  const achievements = achievementsQuery.data ?? [];
  const state = stateQuery.data;
  const editable = state?.editable ?? false;
  const delegateOptions = delegatesQuery.data?.results ?? [];
  const selectedMissing =
    form.registrationId !== "" && !delegateOptions.some((row) => row.id === form.registrationId);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDelegateSearch("");
    setIsFormOpen(true);
  };

  return (
    <>
      <Helmet title="Results" />
      <WorkspacePage
        title="Results & Awards"
        description="Record awards for your delegates, then submit them to MUNHub for review."
        actions={
          editable ? (
            <Button size="sm" onClick={openCreate}>
              <Plus aria-hidden /> Add award
            </Button>
          ) : undefined
        }
      >
        {stateQuery.isPending ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : stateQuery.isError ? (
          <p role="alert" className="text-body-md text-destructive">
            {stateQuery.error.message}
          </p>
        ) : state ? (
          <ResultsStatusCard
            state={state}
            submitting={submitMutation.isPending}
            onSubmit={() => {
              if (window.confirm("Submit these results for review? Awards are locked until MUNHub responds.")) {
                submitMutation.mutate();
              }
            }}
          />
        ) : null}

        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Awards" className="flex flex-col gap-md">
            {achievementsQuery.isLoading && (
              <p className="text-body-md text-muted-foreground">Loading awards...</p>
            )}
            {achievementsQuery.isError && (
              <p className="text-body-md text-destructive">{achievementsQuery.error.message}</p>
            )}
            {!achievementsQuery.isLoading && achievements.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <Award className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No awards recorded yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Record best delegate, honorable mention, or other awards for confirmed or checked-in delegates.
                </p>
                {editable && (
                  <Button className="mt-lg" size="sm" onClick={openCreate}>
                    <Plus aria-hidden /> Add first award
                  </Button>
                )}
              </div>
            )}
            {achievements.map((achievement) => (
              <Card key={achievement.id} size="sm">
                <CardContent className="flex flex-wrap items-start justify-between gap-md">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                      <h2 className="font-display text-title-sm text-ink">{achievement.award}</h2>
                      {achievement.verificationStatus === "verified" && (
                        <span className="inline-flex items-center gap-xxs text-caption text-success-text">
                          <CircleCheck className="size-3.5" aria-hidden /> Verified
                        </span>
                      )}
                    </div>
                    <p className="mt-xxs text-body-md text-body">
                      {achievement.delegateName} ({achievement.delegateEmail})
                    </p>
                    <p className="mt-xs text-body-md text-muted-foreground">
                      {[achievement.committee, achievement.portfolio].filter(Boolean).join(" · ") ||
                        "No committee or portfolio noted"}
                    </p>
                    <p className="mt-xs text-caption text-muted-foreground">
                      Recorded {formatDate(achievement.createdAt)}
                    </p>
                  </div>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete award: ${achievement.award}`}
                      onClick={() => {
                        if (window.confirm(`Delete award "${achievement.award}"?`)) {
                          deleteMutation.mutate(achievement.id);
                        }
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>
          {isFormOpen && editable && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Add award</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-md"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!form.registrationId) {
                      toast.error("Select a delegate");
                      return;
                    }
                    if (!form.award.trim()) {
                      toast.error("Award name is required");
                      return;
                    }
                    createMutation.mutate();
                  }}
                >
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-delegate-search">Search roster</Label>
                    <Input
                      id="award-delegate-search"
                      type="search"
                      placeholder="Name, email or institution"
                      value={delegateSearch}
                      maxLength={100}
                      onChange={(event) => setDelegateSearch(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-delegate">Delegate</Label>
                    <select
                      id="award-delegate"
                      className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                      value={form.registrationId}
                      onChange={(event) => setForm({ ...form, registrationId: event.target.value })}
                    >
                      <option value="">Select a delegate</option>
                      {selectedMissing && <option value={form.registrationId}>Previously selected delegate</option>}
                      {delegateOptions.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.user.name} — {row.committee?.name ?? "Unassigned"}
                        </option>
                      ))}
                    </select>
                    <p className="text-caption text-muted-foreground">
                      {delegatesQuery.isFetching
                        ? "Searching..."
                        : delegatesQuery.data && delegatesQuery.data.total > delegateOptions.length
                          ? `Showing ${delegateOptions.length} of ${delegatesQuery.data.total} — search to narrow down.`
                          : "Only confirmed or checked-in delegates can receive awards."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-name">Award</Label>
                    <Input
                      id="award-name"
                      placeholder="e.g. Best Delegate"
                      value={form.award}
                      maxLength={120}
                      onChange={(event) => setForm({ ...form, award: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-committee">Committee (optional override)</Label>
                    <Input
                      id="award-committee"
                      placeholder="Defaults to the delegate's committee"
                      value={form.committee ?? ""}
                      maxLength={120}
                      onChange={(event) => setForm({ ...form, committee: event.target.value || null })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-portfolio">Portfolio (optional override)</Label>
                    <Input
                      id="award-portfolio"
                      placeholder="Defaults to the delegate's portfolio"
                      value={form.portfolio ?? ""}
                      maxLength={120}
                      onChange={(event) => setForm({ ...form, portfolio: event.target.value || null })}
                    />
                  </div>
                  <div className="flex justify-end gap-xs">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Saving..." : "Add award"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </WorkspacePage>
    </>
  );
}

interface ResultsStatusCardProps {
  state: ResultsState;
  submitting: boolean;
  onSubmit: () => void;
}

function ResultsStatusCard({ state, submitting, onSubmit }: ResultsStatusCardProps) {
  const submittedOn = state.submittedAt ? formatDate(state.submittedAt) : null;

  if (state.munStatus === "RESULTS_UNDER_REVIEW") {
    return (
      <StatusShell icon={<Lock className="size-5 text-info-text" aria-hidden />} title="Results under review">
        Submitted{submittedOn ? ` on ${submittedOn}` : ""}. Awards are locked while MUNHub reviews them — we'll
        either approve them or send them back with a note.
      </StatusShell>
    );
  }
  if (state.munStatus === "COMPLETED" || state.munStatus === "ARCHIVED") {
    return (
      <StatusShell
        icon={<CircleCheck className="size-5 text-success-text" aria-hidden />}
        title="Results approved"
      >
        MUNHub approved these results and the conference is complete. Awards are verified and can no longer be
        changed.
      </StatusShell>
    );
  }
  if (state.munStatus === "CANCELLED") {
    return (
      <StatusShell icon={<Lock className="size-5 text-muted-foreground" aria-hidden />} title="Conference cancelled">
        Results can't be recorded for a cancelled conference.
      </StatusShell>
    );
  }
  if (!state.canSubmit) {
    return (
      <StatusShell icon={<Award className="size-5 text-muted-foreground" aria-hidden />} title="Results open after the conference starts">
        You can record awards now. Submitting them for review becomes available once the conference is under way.
      </StatusShell>
    );
  }

  return (
    <StatusShell
      icon={
        state.returnNote ? (
          <Undo2 className="size-5 text-warning-text" aria-hidden />
        ) : (
          <Send className="size-5 text-muted-foreground" aria-hidden />
        )
      }
      title={state.returnNote ? "MUNHub sent your results back" : "Ready to submit results"}
      action={
        <Button size="sm" onClick={onSubmit} disabled={submitting || state.awardCount === 0}>
          <Send aria-hidden /> {submitting ? "Submitting..." : "Submit results for review"}
        </Button>
      }
    >
      {state.returnNote ? (
        <>
          <span className="block rounded-sm border border-warning/30 bg-warning/15 px-sm py-xs text-warning-text whitespace-pre-line">
            {state.returnNote}
          </span>
          <span className="mt-xs block">Update the awards, then submit again.</span>
        </>
      ) : state.awardCount === 0 ? (
        "Record at least one award, then submit the results for MUNHub to review."
      ) : (
        `${state.awardCount} award${state.awardCount === 1 ? "" : "s"} recorded. Once submitted, awards are locked until MUNHub reviews them.`
      )}
    </StatusShell>
  );
}

function StatusShell({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-1 items-start gap-sm">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="flex min-w-0 flex-col gap-xxs">
            <h2 className="text-label-md text-ink">{title}</h2>
            <div className="text-body-md text-body">{children}</div>
          </div>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
