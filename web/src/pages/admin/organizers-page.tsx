import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { SearchIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { listOrganizers, reinstateOrganizer, suspendOrganizer } from "@/api/organizer-admin";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Badge } from "@/components/ui/badge";
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
import type { OrganizerRow } from "@/types/organizer-admin";

const PAGE_SIZE = 20;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AdminOrganizersPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [suspendTarget, setSuspendTarget] = useState<OrganizerRow | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  // Debounce the raw input into the value that actually drives the query, and
  // reset back to the first page whenever the search term changes.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE, search: search || undefined };
  const organizersQuery = useQuery({
    queryKey: queryKeys.adminOrganizers(params),
    queryFn: () => listOrganizers(params),
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "organizers"] });

  const suspendMutation = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) => suspendOrganizer(userId, reason),
    onSuccess: async () => {
      await refresh();
      setSuspendTarget(null);
      setSuspendReason("");
      toast.success("Organizer suspended");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to suspend organizer"),
  });

  const reinstateMutation = useMutation({
    mutationFn: reinstateOrganizer,
    onSuccess: async () => {
      await refresh();
      toast.success("Organizer reinstated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to reinstate organizer"),
  });

  const results = organizersQuery.data?.results ?? [];
  const total = organizersQuery.data?.total ?? 0;
  const suspendedCount = results.filter((organizer) => organizer.suspended).length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSuspendSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    suspendMutation.mutate({ userId: suspendTarget.id, reason: suspendReason.trim() });
  };

  return (
    <AdminPageFrame
      title="Organizers"
      description="Suspending an organizer only blocks their login — it does not touch their MUNs. Review a specific MUN's content separately."
    >
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <Label htmlFor="organizer-search">Search</Label>
          <div className="relative w-full max-w-sm">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="organizer-search"
              type="search"
              placeholder="Search by name or email"
              className="pl-xxl"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <Button variant="link" size="sm" className="h-auto w-fit p-0" render={<Link to="/admin/review" />}>
            Application review queue
          </Button>
        </div>

        {total > 0 && (
          <dl className="flex items-center gap-lg">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">Total</dt>
              <dd className="font-display text-title-lg tabular-nums text-ink">{total}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                Suspended (this page)
              </dt>
              <dd className="font-display text-title-lg tabular-nums text-ink">{suspendedCount}</dd>
            </div>
          </dl>
        )}
      </div>

      {organizersQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : organizersQuery.isError ? (
        <p className="text-body-md text-destructive">
          {organizersQuery.error instanceof Error
            ? organizersQuery.error.message
            : "Unable to load organizers right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <UsersIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">
            {search ? "No organizers match that search." : "No organizer accounts yet."}
          </p>
          <p className="max-w-sm text-body-md text-muted-foreground">
            {search
              ? "Try a different name or email."
              : "Organizer accounts are created when an organizer application is submitted."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[48rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">Organizer</th>
                <th className="px-md py-sm font-medium">Email</th>
                <th className="px-md py-sm font-medium">Status</th>
                <th className="px-md py-sm font-medium">Joined</th>
                <th className="px-md py-sm font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((organizer) => (
                <tr key={organizer.id} className="border-b border-border last:border-0">
                  <td className="px-md py-sm text-ink">
                    <div className="font-medium">{organizer.name}</div>
                    {organizer.institution && (
                      <div className="text-body-md text-muted-foreground">{organizer.institution}</div>
                    )}
                  </td>
                  <td className="px-md py-sm text-muted-foreground">{organizer.email}</td>
                  <td className="px-md py-sm">
                    {organizer.suspended ? (
                      <Badge variant="destructive">Suspended</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                    {organizer.suspended && organizer.suspendedReason && (
                      <p className="mt-xxs max-w-xs text-body-md text-muted-foreground">
                        {organizer.suspendedReason}
                      </p>
                    )}
                  </td>
                  <td className="px-md py-sm tabular-nums text-muted-foreground">
                    {formatDate(organizer.createdAt)}
                  </td>
                  <td className="px-md py-sm text-right">
                    {organizer.suspended ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reinstateMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Reinstate ${organizer.name}? They will be able to sign in again.`)) {
                            reinstateMutation.mutate(organizer.id);
                          }
                        }}
                      >
                        Reinstate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSuspendTarget(organizer);
                          setSuspendReason("");
                        }}
                      >
                        Suspend
                      </Button>
                    )}
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
        open={suspendTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSuspendTarget(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleSuspendSubmit} className="flex flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>Suspend {suspendTarget?.name}</DialogTitle>
              <DialogDescription>
                This blocks the organizer's login only — it does not unpublish or otherwise touch their MUNs.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="suspend-reason">Reason</Label>
              <Input
                id="suspend-reason"
                value={suspendReason}
                onChange={(event) => setSuspendReason(event.target.value)}
                placeholder="Why is this account being suspended?"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setSuspendTarget(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={suspendMutation.isPending || !suspendReason.trim()}
              >
                {suspendMutation.isPending ? "Suspending..." : "Suspend organizer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminPageFrame>
  );
}
