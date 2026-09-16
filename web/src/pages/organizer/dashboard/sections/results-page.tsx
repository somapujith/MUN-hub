import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Award, Plus, Trash2 } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { getDelegateList } from "@/api/organizer-dashboard";
import { createAchievement, deleteAchievement, listMunAchievements } from "@/api/results";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { CreateAchievementInput } from "@/types/results";

const EMPTY_FORM: CreateAchievementInput = {
  registrationId: "",
  committee: "",
  portfolio: "",
  award: "",
};

// Enough to populate the "who won this" picker for a typical single-conference
// roster without pulling every historical registration — this is a minimal
// manual-entry scaffold, not a bulk-import or rankings system.
const DELEGATE_PICKER_LIMIT = 200;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

/**
 * Minimal read-only-ish results scaffold: list recorded awards + a manual
 * add/delete form. Backed by lib/actions/results.ts, itself a thin CRUD layer
 * over the `achievements` table, which CLAUDE.md documents as "scaffolded per
 * PRD — no logic/UI in MVP". Deliberately does not build a rankings import,
 * per-award verification workflow, or public results-publication flow.
 */
export function OrganizerResultsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<CreateAchievementInput>(EMPTY_FORM);

  const achievementsQuery = useQuery({
    queryKey: ["organizer", "achievements", munId],
    queryFn: () => listMunAchievements(munId),
    enabled: Boolean(munId),
  });

  const delegatesQuery = useQuery({
    queryKey: ["organizer", "delegates-for-results", munId],
    queryFn: () => getDelegateList(munId, { limit: DELEGATE_PICKER_LIMIT }),
    enabled: Boolean(munId),
  });

  const delegateById = useMemo(() => {
    const map = new Map<string, { name: string; email: string; committee: string | null }>();
    for (const row of delegatesQuery.data?.results ?? []) {
      map.set(row.id, {
        name: row.user.name,
        email: row.user.email,
        committee: row.committee?.name ?? null,
      });
    }
    return map;
  }, [delegatesQuery.data]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["organizer", "achievements", munId] });

  const createMutation = useMutation({
    mutationFn: () => createAchievement(munId, form),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setForm(EMPTY_FORM);
      toast.success("Award recorded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record award"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAchievement,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete award"),
  });

  const achievements = achievementsQuery.data ?? [];
  const delegateOptions = delegatesQuery.data?.results ?? [];

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setIsFormOpen(true);
  };

  return (
    <>
      <Helmet title="Results" />
      <WorkspacePage
        title="Results & Awards"
        description="Manual award entry for this conference."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> Add award
          </Button>
        }
      >
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
                  Record best delegate, honorable mention, or other awards after the conference concludes.
                </p>
                <Button className="mt-lg" size="sm" onClick={openCreate}>
                  <Plus aria-hidden /> Add first award
                </Button>
              </div>
            )}
            {achievements.map((achievement) => {
              const delegate = delegateById.get(achievement.registrationId);
              const committeeLabel = achievement.committee ?? delegate?.committee ?? null;
              return (
                <Card key={achievement.id} size="sm">
                  <CardContent className="flex flex-wrap items-start justify-between gap-md">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-title-sm text-ink">{achievement.award}</h2>
                      <p className="mt-xxs text-body-md text-body">
                        {delegate
                          ? `${delegate.name} (${delegate.email})`
                          : `Registration ${achievement.registrationId.slice(0, 8)}…`}
                      </p>
                      <p className="mt-xs text-body-md text-muted-foreground">
                        {[committeeLabel, achievement.portfolio].filter(Boolean).join(" · ") ||
                          "No committee or portfolio noted"}
                      </p>
                      <p className="mt-xs text-caption text-muted-foreground">
                        Recorded {formatDate(achievement.createdAt)}
                      </p>
                    </div>
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
                  </CardContent>
                </Card>
              );
            })}
          </section>
          {isFormOpen && (
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
                    <Label htmlFor="award-delegate">Delegate</Label>
                    <select
                      id="award-delegate"
                      className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                      value={form.registrationId}
                      onChange={(event) => setForm({ ...form, registrationId: event.target.value })}
                    >
                      <option value="">Select a delegate</option>
                      {delegateOptions.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.user.name} — {row.committee?.name ?? "Unassigned"}
                        </option>
                      ))}
                    </select>
                    {delegatesQuery.data && delegatesQuery.data.total > delegateOptions.length && (
                      <p className="text-caption text-muted-foreground">
                        Showing the first {delegateOptions.length} of {delegatesQuery.data.total} delegates.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-name">Award</Label>
                    <Input
                      id="award-name"
                      placeholder="e.g. Best Delegate"
                      value={form.award}
                      onChange={(event) => setForm({ ...form, award: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-committee">Committee (optional override)</Label>
                    <Input
                      id="award-committee"
                      value={form.committee ?? ""}
                      onChange={(event) => setForm({ ...form, committee: event.target.value || null })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="award-portfolio">Portfolio (optional)</Label>
                    <Input
                      id="award-portfolio"
                      value={form.portfolio ?? ""}
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
