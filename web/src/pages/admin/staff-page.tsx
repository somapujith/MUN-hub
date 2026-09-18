import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, SearchIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import {
  changeStaffRole,
  createStaffAccount,
  issueStaffSetPasswordLink,
  listStaff,
  reinstateStaff,
  resetStaffMfa,
  suspendStaff,
} from "@/api/admin-staff";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { ReasonDialog } from "@/components/admin/reason-dialog";
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
import { formatAdminDate, formatAdminDateTime } from "@/lib/admin/go-live-labels";
import { STAFF_ROLE_LABELS, STAFF_ROLES, useAdminPermissions } from "@/lib/admin/permissions";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { adminSelectClassName } from "@/lib/admin/styles";
import { usePageClamp } from "@/lib/admin/use-page-clamp";
import type { SetPasswordLink, StaffRole, StaffRow } from "@/types/admin-staff";

const PAGE_SIZE = 50;

const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  OPERATIONS: "Reviews applications, content and support. Can't publish or change what is public.",
  ADMIN: "Everything operations can do, plus publishing, suspensions, payment verification and lifecycle changes.",
  SUPER_ADMIN: "Everything an admin can do, plus managing staff accounts.",
};

interface IssuedLink extends SetPasswordLink {
  name: string;
  email: string;
  isNewAccount: boolean;
}

/**
 * Staff accounts (OPERATIONS / ADMIN / SUPER_ADMIN). Every staff member can
 * see the directory; only a super admin can add people, change roles,
 * suspend or reinstate, or issue a new set-password link. Nobody can change
 * their own account here.
 */
export function AdminStaffPage() {
  const queryClient = useQueryClient();
  const { canManageStaff, userId } = useAdminPermissions();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<StaffRole | "">("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<StaffRow | null>(null);
  const [issuedLink, setIssuedLink] = useState<IssuedLink | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = { q: search || undefined, role: roleFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const staffQuery = useQuery({
    queryKey: adminQueryKeys.staff(params),
    queryFn: () => listStaff(params),
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.staffAll() });
  const onError = (fallback: string) => (error: unknown) =>
    toast.error(error instanceof Error ? error.message : fallback);

  const roleMutation = useMutation({
    mutationFn: ({ staff, role }: { staff: StaffRow; role: StaffRole }) => changeStaffRole(staff.id, role),
    onSuccess: async (updated) => {
      await refresh();
      toast.success(`${updated.name} is now ${STAFF_ROLE_LABELS[updated.role].toLowerCase()}`);
    },
    onError: onError("Unable to change the role"),
  });

  const suspendMutation = useMutation({
    mutationFn: ({ staff, reason }: { staff: StaffRow; reason: string }) => suspendStaff(staff.id, reason),
    onSuccess: async (updated) => {
      await refresh();
      setSuspendTarget(null);
      toast.success(`${updated.name} is suspended and signed out`);
    },
    onError: onError("Unable to suspend this account"),
  });

  const reinstateMutation = useMutation({
    mutationFn: (staff: StaffRow) => reinstateStaff(staff.id),
    onSuccess: async (updated) => {
      await refresh();
      toast.success(`${updated.name} can sign in again`);
    },
    onError: onError("Unable to reinstate this account"),
  });

  const linkMutation = useMutation({
    mutationFn: (staff: StaffRow) => issueStaffSetPasswordLink(staff.id),
    onSuccess: (link, staff) => {
      setIssuedLink({ ...link, name: staff.name, email: staff.email, isNewAccount: false });
    },
    onError: onError("Unable to issue a link"),
  });

  const resetMfaMutation = useMutation({
    mutationFn: (staff: StaffRow) => resetStaffMfa(staff.id),
    onSuccess: (_result, staff) => {
      toast.success(`Two-factor authentication cleared for ${staff.name} — they can set it up again`);
    },
    onError: onError("Unable to reset two-factor authentication"),
  });

  const results = staffQuery.data?.results ?? [];
  const total = staffQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const busy =
    roleMutation.isPending ||
    suspendMutation.isPending ||
    reinstateMutation.isPending ||
    linkMutation.isPending ||
    resetMfaMutation.isPending;

  // A role change or suspension can drop someone out of the current
  // filtered/paged view (e.g. changing the last row's role away from an
  // active role filter), which can strand the page past the new last page.
  usePageClamp(Boolean(staffQuery.data), page, setPage, totalPages, (newPage) =>
    toast.message(`Moved to page ${newPage + 1} — no more results on the page you were viewing.`),
  );

  return (
    <AdminPageFrame
      title="Staff"
      description="People who can sign in to this console. Only super admins can add people or change their access."
    >
      <div className="flex flex-wrap items-end gap-md">
        <div className="flex w-full max-w-sm flex-col gap-xs">
          <Label htmlFor="staff-search">Search</Label>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-md size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="staff-search"
              type="search"
              placeholder="Name or email"
              className="pl-xxl"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="staff-role-filter">Role</Label>
          <select
            id="staff-role-filter"
            className={adminSelectClassName}
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value as StaffRole | "");
              setPage(0);
            }}
          >
            <option value="">All roles</option>
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {STAFF_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        {canManageStaff && (
          <Button size="sm" className="sm:ml-auto" onClick={() => setCreateOpen(true)}>
            <UserPlusIcon aria-hidden /> Add staff member
          </Button>
        )}
      </div>

      {!canManageStaff && (
        <p className="rounded-md border border-border bg-card px-md py-sm text-body-md text-muted-foreground">
          You can view the staff list. Ask a super admin to add someone or change access.
        </p>
      )}

      {staffQuery.isLoading ? (
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : staffQuery.isError ? (
        <p className="text-body-md text-destructive">
          {staffQuery.error instanceof Error ? staffQuery.error.message : "Unable to load staff right now."}
        </p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-xxl text-center">
          <UsersIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-title-md text-ink">No staff match.</p>
          <p className="max-w-sm text-body-md text-muted-foreground">Try a different name, email or role.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[52rem] text-left text-body-md">
            <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
              <tr>
                <th className="px-md py-sm font-medium">Name</th>
                <th className="px-md py-sm font-medium">Role</th>
                <th className="px-md py-sm font-medium">Status</th>
                <th className="px-md py-sm font-medium">Added</th>
                {canManageStaff && <th className="px-md py-sm text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((staff) => {
                const isSelf = staff.id === userId;
                const roleSelectId = `staff-role-${staff.id}`;
                return (
                  <tr key={staff.id} className="border-b border-border align-top last:border-0">
                    <td className="px-md py-sm">
                      <p className="font-medium text-ink">
                        {staff.name}
                        {isSelf && <span className="font-normal text-muted-foreground"> (you)</span>}
                      </p>
                      <p className="text-body-md break-all text-muted-foreground">{staff.email}</p>
                    </td>
                    <td className="px-md py-sm">
                      {canManageStaff && !isSelf ? (
                        <>
                          <label htmlFor={roleSelectId} className="sr-only">
                            Role for {staff.name}
                          </label>
                          <select
                            id={roleSelectId}
                            className={adminSelectClassName}
                            value={staff.role}
                            disabled={busy}
                            onChange={(event) => {
                              const role = event.target.value as StaffRole;
                              if (
                                window.confirm(
                                  `Change ${staff.name} from ${STAFF_ROLE_LABELS[staff.role]} to ${STAFF_ROLE_LABELS[role]}?\n\n${ROLE_DESCRIPTIONS[role]}`,
                                )
                              ) {
                                roleMutation.mutate({ staff, role });
                              }
                            }}
                          >
                            {STAFF_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {STAFF_ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <Badge variant={staff.role === "OPERATIONS" ? "secondary" : "info"}>
                          {STAFF_ROLE_LABELS[staff.role]}
                        </Badge>
                      )}
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex flex-col items-start gap-xxs">
                        {staff.suspended ? (
                          <Badge variant="destructive">Suspended</Badge>
                        ) : staff.passwordSet ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="warning">Password not set</Badge>
                        )}
                        {staff.suspended && staff.suspendedReason && (
                          <p className="max-w-xs text-body-md text-muted-foreground">{staff.suspendedReason}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-md py-sm whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatAdminDate(staff.createdAt)}
                    </td>
                    {canManageStaff && (
                      <td className="px-md py-sm text-right">
                        {isSelf ? (
                          <span className="text-body-md text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-xs">
                            {!staff.suspended && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Issue a new set-password link for ${staff.name}? Any earlier unused link stops working.`,
                                    )
                                  ) {
                                    linkMutation.mutate(staff);
                                  }
                                }}
                              >
                                New password link
                              </Button>
                            )}
                            {staff.suspended ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm(`Reinstate ${staff.name}? They will be able to sign in again.`)) {
                                    reinstateMutation.mutate(staff);
                                  }
                                }}
                              >
                                Reinstate
                              </Button>
                            ) : (
                              <Button size="sm" variant="destructive" disabled={busy} onClick={() => setSuspendTarget(staff)}>
                                Suspend
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Reset two-factor authentication for ${staff.name}? Use this if they've lost their device. They'll need to set it up again.`,
                                  )
                                ) {
                                  resetMfaMutation.mutate(staff);
                                }
                              }}
                            >
                              Reset 2FA
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-md border-t border-border px-md py-sm">
              <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <p className="text-body-md tabular-nums text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
              </p>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {canManageStaff && (
        <CreateStaffDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={async (result) => {
            await refresh();
            setCreateOpen(false);
            setIssuedLink({
              setPasswordUrl: result.setPasswordUrl,
              expiresAt: result.expiresAt,
              name: result.staff.name,
              email: result.staff.email,
              isNewAccount: true,
            });
          }}
        />
      )}

      <ReasonDialog
        open={suspendTarget !== null}
        title={`Suspend ${suspendTarget?.name ?? ""}`}
        description="They are signed out everywhere and can't sign in until a super admin reinstates them."
        confirmLabel="Suspend account"
        pendingLabel="Suspending…"
        isPending={suspendMutation.isPending}
        onConfirm={(reason) => suspendTarget && suspendMutation.mutate({ staff: suspendTarget, reason })}
        onClose={() => setSuspendTarget(null)}
      />

      <IssuedLinkDialog link={issuedLink} onClose={() => setIssuedLink(null)} />
    </AdminPageFrame>
  );
}

function CreateStaffDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: Awaited<ReturnType<typeof createStaffAccount>>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("OPERATIONS");

  const reset = () => {
    setName("");
    setEmail("");
    setRole("OPERATIONS");
  };

  const mutation = useMutation({
    mutationFn: () => createStaffAccount({ name: name.trim(), email: email.trim(), role }),
    onSuccess: async (result) => {
      reset();
      await onCreated(result);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to add this staff member"),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
          <DialogHeader>
            <DialogTitle>Add staff member</DialogTitle>
            <DialogDescription>
              The account starts without a password. You&apos;ll get a one-time link to send them so they can set one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="new-staff-name">Full name</Label>
            <Input
              id="new-staff-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="new-staff-email">Work email</Label>
            <Input
              id="new-staff-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="new-staff-role">Role</Label>
            <select
              id="new-staff-role"
              className={adminSelectClassName}
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
            >
              {STAFF_ROLES.map((option) => (
                <option key={option} value={option}>
                  {STAFF_ROLE_LABELS[option]}
                </option>
              ))}
            </select>
            <p className="text-body-md text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? "Adding…" : "Add and get link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shows a freshly issued set-password link once. It is never stored client-side. */
function IssuedLinkDialog({ link, onClose }: { link: IssuedLink | null; onClose: () => void }) {
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.setPasswordUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually");
    }
  };

  return (
    <Dialog
      open={link !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{link?.isNewAccount ? `${link.name} was added` : `New link for ${link?.name ?? ""}`}</DialogTitle>
          <DialogDescription>
            Send this link to {link?.email} yourself. Anyone with it can set this account&apos;s password, and it
            won&apos;t be shown again. It works once and expires {formatAdminDateTime(link?.expiresAt)}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="issued-link">Set-password link</Label>
          <Input
            id="issued-link"
            readOnly
            value={link?.setPasswordUrl ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
          <Button type="button" size="sm" onClick={copy}>
            <CopyIcon aria-hidden /> Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
