import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Edit3, Layers, Plus, Trash2 } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { cn } from "cn";
import {
  createCommittee,
  deleteCommittee,
  listCommittees,
  updateCommittee,
} from "@/api/committees";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommitteePortfolios } from "@/components/organizer/committee-portfolios";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { Committee, CommitteeInput } from "@/types/committee";

const EMPTY_FORM: CommitteeInput = {
  name: "",
  agenda: "",
  description: "",
  capacity: 50,
};

function toForm(committee: Committee): CommitteeInput {
  return {
    name: committee.name,
    agenda: committee.agenda ?? "",
    description: committee.description ?? "",
    capacity: committee.capacity,
  };
}

export function OrganizerCommitteesPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Committee | null>(null);
  const [form, setForm] = useState<CommitteeInput>(EMPTY_FORM);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const committeesQuery = useQuery({
    queryKey: queryKeys.committees(munId),
    queryFn: () => listCommittees(munId),
    enabled: Boolean(munId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.committees(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
    ]);

  const saveMutation = useMutation({
    mutationFn: () =>
      editing ? updateCommittee(editing.id, form) : createCommittee(munId, form),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setEditing(null);
      toast.success(editing ? "Committee updated" : "Committee added");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to save committee"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCommittee,
    onSuccess: refresh,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to delete committee"),
  });

  const committees = committeesQuery.data ?? [];
  // The empty state renders its own "Add first committee" CTA, and the open
  // form is itself the add surface — in both cases the header button would be
  // a second, redundant entry point to the same action. Matches the
  // `{!isFormOpen && <Button…>}` suppression used on the accommodation page.
  const showHeaderAddButton =
    isFormOpen === false && (committeesQuery.isLoading || committees.length > 0);
  // Anything rendering in the left column: the list, or a loading/error line.
  const hasListContent =
    committees.length > 0 || committeesQuery.isLoading || committeesQuery.isError;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIsFormOpen(true);
  };

  const openEdit = (committee: Committee) => {
    setEditing(committee);
    setForm(toForm(committee));
    setIsFormOpen(true);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Committee name is required");
      return;
    }
    if (!Number.isInteger(form.capacity) || form.capacity < 1) {
      toast.error("Capacity must be a whole number of at least 1");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <>
      <Helmet title="Committees & Portfolios" />
      <WorkspacePage
        title="Committees & Portfolios"
        description="Committees delegates can apply to, and the portfolios (countries, people or organizations) they can represent in each."
        actions={
          showHeaderAddButton ? (
            <Button size="sm" onClick={openCreate}>
              <Plus aria-hidden /> Add committee
            </Button>
          ) : null
        }
      >
        <div
          className={cn(
            "grid gap-lg",
            // Only split into list + form columns once there's a list to sit
            // beside. With no committees yet the form would otherwise be a
            // cramped 22rem rail next to an empty column.
            hasListContent && "xl:grid-cols-[minmax(0,1fr)_22rem]",
          )}
        >
          <section aria-label="Committees" className="flex min-w-0 flex-col gap-md">
            {committeesQuery.isLoading && (
              <p className="text-body-md text-muted-foreground">Loading committees...</p>
            )}
            {committeesQuery.isError && (
              <p className="text-body-md text-destructive">
                {committeesQuery.error instanceof Error
                  ? committeesQuery.error.message
                  : "Unable to load committees."}
              </p>
            )}
            {!committeesQuery.isLoading && committees.length === 0 && !isFormOpen && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <Layers className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No committees yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Add the committees delegates will be able to register for.
                </p>
                <Button className="mt-lg" size="sm" onClick={openCreate}>
                  <Plus aria-hidden /> Add first committee
                </Button>
              </div>
            )}
            {committees.map((committee) => (
              <Card key={committee.id} size="sm">
                <CardContent className="flex flex-col gap-sm">
                  <div className="flex flex-wrap items-start gap-md">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                        <h2 className="font-display text-title-sm text-ink">{committee.name}</h2>
                        <span className="text-caption text-muted-foreground">
                          Capacity {committee.capacity}
                        </span>
                      </div>
                      {committee.agenda && (
                        <p className="mt-xxs text-body-md text-body">{committee.agenda}</p>
                      )}
                      {committee.description && (
                        <p className="mt-sm max-w-2xl whitespace-pre-wrap text-body-md leading-relaxed text-muted-foreground">
                          {committee.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-xxs">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Edit ${committee.name}`}
                        onClick={() => openEdit(committee)}
                      >
                        <Edit3 aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${committee.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete ${committee.name} and its portfolios?`)) {
                            deleteMutation.mutate(committee.id);
                          }
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <CommitteePortfolios munId={munId} committeeId={committee.id} committeeName={committee.name} />
                </CardContent>
              </Card>
            ))}
          </section>
          {isFormOpen && (
            // `h-fit` keeps the card sized to its fields instead of stretching
            // to the grid row. Without a list beside it the card owns the full
            // width, so cap it at the same 22rem the side rail uses.
            <Card className={cn("h-fit", !hasListContent && "w-full max-w-[22rem]")}>
              <CardHeader>
                <CardTitle>{editing ? "Edit committee" : "Add committee"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-md" onSubmit={handleSubmit}>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="committee-name">Name</Label>
                    <Input
                      id="committee-name"
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="committee-agenda">Agenda</Label>
                    <Input
                      id="committee-agenda"
                      value={form.agenda}
                      onChange={(event) => setForm({ ...form, agenda: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="committee-capacity">Capacity</Label>
                    <Input
                      id="committee-capacity"
                      type="number"
                      min="1"
                      value={form.capacity}
                      onChange={(event) =>
                        setForm({ ...form, capacity: Number(event.target.value) || 0 })
                      }
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="committee-description">Description</Label>
                    <textarea
                      id="committee-description"
                      className="min-h-28 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                      value={form.description}
                      onChange={(event) =>
                        setForm({ ...form, description: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-xs">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsFormOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                      {saveMutation.isPending
                        ? "Saving..."
                        : editing
                          ? "Save changes"
                          : "Add committee"}
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
