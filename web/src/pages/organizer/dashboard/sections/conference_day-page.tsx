import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CalendarClock, Edit3, MapPin, Plus, Trash2 } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  createScheduleItem,
  deleteScheduleItem,
  listCommitteesForSchedule,
  listScheduleItems,
  updateScheduleItem,
} from "@/api/mun-schedule";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { CheckInPanel } from "@/components/organizer/check-in-panel";
import { useOrganizerWorkspaceMuns } from "@/layouts/workspace-layout";
import type { ScheduleItem, ScheduleItemInput, ScheduleItemKind } from "@/types/mun-schedule";

const KIND_OPTIONS: Array<{ value: ScheduleItemKind; label: string }> = [
  { value: "OPENING_CEREMONY", label: "Opening ceremony" },
  { value: "COMMITTEE_SESSION", label: "Committee session" },
  { value: "BREAK", label: "Break" },
  { value: "LUNCH", label: "Lunch" },
  { value: "CRISIS", label: "Crisis" },
  { value: "CLOSING_CEREMONY", label: "Closing ceremony" },
  { value: "AWARDS", label: "Awards" },
  { value: "OTHER", label: "Other" },
];

interface FormState {
  committeeId: string;
  title: string;
  kind: ScheduleItemKind;
  startsAt: string;
  endsAt: string;
  location: string;
  displayOrder: number;
}

const EMPTY_FORM: FormState = {
  committeeId: "",
  title: "",
  kind: "COMMITTEE_SESSION",
  startsAt: "",
  endsAt: "",
  location: "",
  displayOrder: 0,
};

/** `datetime-local` inputs want naive local-time strings, not the offset-bearing ISO the API returns. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toForm(item: ScheduleItem): FormState {
  return {
    committeeId: item.committeeId ?? "",
    title: item.title,
    kind: item.kind,
    startsAt: toLocalInputValue(item.startsAt),
    endsAt: toLocalInputValue(item.endsAt),
    location: item.location ?? "",
    displayOrder: item.displayOrder,
  };
}

function toInput(form: FormState): ScheduleItemInput {
  return {
    committeeId: form.committeeId || null,
    title: form.title,
    kind: form.kind,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    location: form.location || null,
    displayOrder: form.displayOrder,
  };
}

function formatRange(item: ScheduleItem): string {
  const start = new Date(item.startsAt);
  const end = new Date(item.endsAt);
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return start.toDateString() === end.toDateString()
    ? `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`
    : `${dateFmt.format(start)} ${timeFmt.format(start)} → ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}

/**
 * Conference Day — door check-in (lib/actions/check-in.ts) on top of the
 * SCHEDULE module (PRD Section 21, lib/actions/mun-schedule.ts +
 * server/routes/mun-schedule.ts); "conference day" in the nav is the
 * operator-facing name for both.
 */
export function OrganizerConferenceDayPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const workspace = useOrganizerWorkspaceMuns();
  const munStatus = workspace.data?.muns.find((mun) => mun.id === munId)?.status;
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const itemsQuery = useQuery({
    queryKey: queryKeys.schedule(munId),
    queryFn: () => listScheduleItems(munId),
    enabled: Boolean(munId),
  });
  const committeesQuery = useQuery({
    queryKey: queryKeys.committees(munId),
    queryFn: () => listCommitteesForSchedule(munId),
    enabled: Boolean(munId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.schedule(munId) });

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = toInput(form);
      return editing ? updateScheduleItem(editing.id, input) : createScheduleItem(munId, input);
    },
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setEditing(null);
      toast.success(editing ? "Schedule item updated" : "Schedule item added");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save schedule item"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScheduleItem,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete schedule item"),
  });

  const items = [...(itemsQuery.data ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIsFormOpen(true);
  };
  const openEdit = (item: ScheduleItem) => {
    setEditing(item);
    setForm(toForm(item));
    setIsFormOpen(true);
  };

  return (
    <>
      <Helmet title="Conference Day" />
      <WorkspacePage
        title="Conference day"
        description="Check delegates in at the door, and keep the run-of-show schedule delegates and staff see for timing, sessions and location."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> Add schedule item
          </Button>
        }
      >
        <CheckInPanel munId={munId} munStatus={munStatus} />
        <h2 className="font-display text-title-md text-ink">Schedule</h2>
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Schedule items" className="flex flex-col gap-md">
            {itemsQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading schedule...</p>}
            {itemsQuery.isError && <p className="text-body-md text-destructive">{itemsQuery.error.message}</p>}
            {!itemsQuery.isLoading && items.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <CalendarClock className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No schedule items yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Build the run-of-show delegates and staff will see.
                </p>
                <Button className="mt-lg" size="sm" onClick={openCreate}>
                  <Plus aria-hidden /> Add first item
                </Button>
              </div>
            )}
            {items.map((item) => {
              const committee = committeesQuery.data?.find((c) => c.id === item.committeeId);
              return (
                <Card key={item.id} size="sm">
                  <CardContent className="flex flex-wrap items-start justify-between gap-md">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                        <h2 className="font-display text-title-sm text-ink">{item.title}</h2>
                        <span className="text-caption text-muted-foreground">
                          {KIND_OPTIONS.find((k) => k.value === item.kind)?.label}
                        </span>
                      </div>
                      <p className="mt-xxs text-body-md text-body">{formatRange(item)}</p>
                      <p className="mt-xs flex flex-wrap items-center gap-x-xs text-body-md text-muted-foreground">
                        {item.location && (
                          <span className="inline-flex items-center gap-xxs">
                            <MapPin className="size-3.5" aria-hidden /> {item.location}
                          </span>
                        )}
                        <span>{committee ? committee.name : "Conference-wide"}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-xxs">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Edit ${item.title}`}
                        onClick={() => openEdit(item)}
                      >
                        <Edit3 aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${item.title}`}
                        onClick={() => {
                          if (window.confirm(`Delete "${item.title}"?`)) deleteMutation.mutate(item.id);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
          {isFormOpen && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>{editing ? "Edit schedule item" : "Add schedule item"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-md"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!form.title.trim() || !form.startsAt || !form.endsAt) {
                      toast.error("Title, start and end time are required");
                      return;
                    }
                    if (new Date(form.endsAt).getTime() <= new Date(form.startsAt).getTime()) {
                      toast.error("End time must be after start time");
                      return;
                    }
                    saveMutation.mutate();
                  }}
                >
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-title">Title</Label>
                    <Input
                      id="sched-title"
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-kind">Kind</Label>
                    <select
                      id="sched-kind"
                      className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                      value={form.kind}
                      onChange={(event) => setForm({ ...form, kind: event.target.value as ScheduleItemKind })}
                    >
                      {KIND_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-committee">Committee</Label>
                    <select
                      id="sched-committee"
                      className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                      value={form.committeeId}
                      onChange={(event) => setForm({ ...form, committeeId: event.target.value })}
                    >
                      <option value="">Conference-wide</option>
                      {(committeesQuery.data ?? []).map((committee) => (
                        <option key={committee.id} value={committee.id}>
                          {committee.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-starts">Starts</Label>
                    <Input
                      id="sched-starts"
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-ends">Ends</Label>
                    <Input
                      id="sched-ends"
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-location">Location</Label>
                    <Input
                      id="sched-location"
                      value={form.location}
                      onChange={(event) => setForm({ ...form, location: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="sched-order">Display order</Label>
                    <Input
                      id="sched-order"
                      type="number"
                      min="0"
                      value={form.displayOrder}
                      onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex justify-end gap-xs">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving..." : editing ? "Save changes" : "Add item"}
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
