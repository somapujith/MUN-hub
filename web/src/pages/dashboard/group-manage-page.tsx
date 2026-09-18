import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2Icon, ClockIcon, MailIcon, UserIcon, XCircleIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrice } from "@/components/shared/currency";
import { getToneClassName } from "@/components/dashboard/registration-status";
import { queryKeys } from "@/api/query-keys";
import {
  cancelGroupInvitation,
  fetchGroupRoster,
  inviteGroupMember,
  releaseGroupSeat,
  resendGroupInvitation,
  type GroupRosterSlot,
} from "@/api/registration-group";
import { NotFoundPage } from "@/pages/not-found-page";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

function SlotStatus({ slot }: { slot: GroupRosterSlot }) {
  if (slot.member) {
    return (
      <Badge variant="outline" className={getToneClassName("success")}>
        <CheckCircle2Icon aria-hidden /> {slot.isHead ? "You (head delegate)" : "Joined"}
      </Badge>
    );
  }
  if (!slot.invitation) {
    return (
      <Badge variant="outline" className={getToneClassName("muted")}>
        Not invited yet
      </Badge>
    );
  }
  switch (slot.invitation.status) {
    case "PENDING":
      return (
        <Badge variant="outline" className={getToneClassName("warning")}>
          <ClockIcon aria-hidden /> Invited — waiting to accept
        </Badge>
      );
    case "EXPIRED":
      return (
        <Badge variant="outline" className={getToneClassName("destructive")}>
          <XCircleIcon aria-hidden /> Invitation expired
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge variant="outline" className={getToneClassName("muted")}>
          Invitation cancelled
        </Badge>
      );
    default:
      return null;
  }
}

/**
 * Head delegate's team-management page for a group/delegation registration:
 * who's accepted, who's pending, resend/cancel a specific slot's invitation,
 * invite into any still-open seat, and the team's total paid. Reachable from
 * the post-payment confirmation page and from the head's own dashboard card
 * (RegistrationCard shows a "Manage your team" link whenever a registration
 * carries a `registrationGroupId`).
 */
export function GroupManagePage() {
  const { groupId = "" } = useParams();
  const queryClient = useQueryClient();
  // See use-scroll-to-top.ts — this page's most common entry point is the
  // "Invite your team" link on the (often tall, scrolled-down) registration
  // confirmation page; without this the browser landed here still scrolled
  // to that offset (measured: scrollY carried over at 215px on a 320px-wide
  // load, showing the roster mid-list instead of "Your team" at the top).
  useScrollToTop();

  const [email, setEmail] = useState("");
  const [invitedName, setInvitedName] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: queryKeys.groupRoster(groupId),
    queryFn: () => fetchGroupRoster(groupId),
    enabled: groupId !== "",
  });

  const invalidateRoster = () => queryClient.invalidateQueries({ queryKey: queryKeys.groupRoster(groupId) });

  const inviteMutation = useMutation({
    mutationFn: () => inviteGroupMember(groupId, { email: email.trim(), invitedName: invitedName.trim() || undefined }),
    onSuccess: async () => {
      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail("");
      setInvitedName("");
      await invalidateRoster();
    },
    onError: (error) => setInviteError(error instanceof Error ? error.message : "Couldn't send that invitation"),
  });

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) => resendGroupInvitation(invitationId),
    onSuccess: async () => {
      toast.success("Invitation re-sent");
      await invalidateRoster();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't resend that invitation"),
  });

  const cancelMutation = useMutation({
    mutationFn: (invitationId: string) => cancelGroupInvitation(invitationId),
    onSuccess: async () => {
      toast.success("Invitation cancelled — that seat is open again");
      await invalidateRoster();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't cancel that invitation"),
  });

  const releaseMutation = useMutation({
    mutationFn: (registrationId: string) => releaseGroupSeat(groupId, registrationId),
    onSuccess: async () => {
      toast.success("Seat released — invite someone else into it below");
      await invalidateRoster();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't release that seat"),
  });

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    if (!email.trim()) return;
    inviteMutation.mutate();
  }

  function handleRelease(slot: GroupRosterSlot) {
    const name = slot.member?.name ?? "this teammate";
    if (
      window.confirm(
        `Release ${name}'s seat? They'll lose access to their registration, and you'll be able to invite someone else into it.`,
      )
    ) {
      releaseMutation.mutate(slot.registrationId);
    }
  }

  if (rosterQuery.isPending) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="content-container flex-1 py-xxl" aria-busy="true" />
        <SiteFooter />
      </div>
    );
  }
  if (rosterQuery.isError || !rosterQuery.data) return <NotFoundPage />;

  const roster = rosterQuery.data;
  const isPaid = roster.status === "CONFIRMED" || roster.status === "ATTENDED" || roster.status === "NO_SHOW";
  const openSlots = roster.slots.filter((slot) => !slot.member && (!slot.invitation || slot.invitation.status !== "PENDING"));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>{`Your team — ${roster.munName} | MUN Hub`}</title>
      </Helmet>
      <SiteHeader />
      <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
        <header className="flex flex-col gap-xs border-b border-border pb-lg">
          <p className="text-caption uppercase text-muted-foreground">Your team</p>
          <h1 className="font-display text-display-md text-ink text-balance">{roster.munName}</h1>
          <p className="text-body-md text-muted-foreground">
            {roster.productName} · {roster.teamSize} seats
          </p>
        </header>

        {!isPaid ? (
          <div className="flex flex-col gap-sm rounded-md border border-warning/30 bg-warning/8 px-md py-md text-body-md text-warning-text">
            <p>
              Your team's payment hasn't gone through yet — invitations can only be sent once it has.{" "}
              <Link to={`/register/${roster.munSlug}/pay?registrationId=${encodeURIComponent(roster.headRegistrationId)}`} className="font-medium underline underline-offset-2">
                Finish payment
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-md rounded-md border border-border bg-surface-soft px-md py-sm">
            <span className="text-label-md text-ink">Total paid for your team</span>
            <span className="font-mono text-title-md tabular-nums text-ink">
              {roster.payment ? formatPrice(roster.payment.amount) : "Free"}
            </span>
          </div>
        )}

        <section className="flex flex-col gap-md">
          <h2 className="text-title-lg text-ink">Roster</h2>
          <ul className="flex flex-col gap-sm">
            {roster.slots.map((slot) => (
              <li
                key={slot.registrationId}
                className="flex flex-wrap items-center justify-between gap-md rounded-md border border-border bg-card px-md py-sm"
              >
                <div className="flex items-center gap-sm">
                  <UserIcon className="size-4 text-muted-foreground" aria-hidden />
                  <div className="flex flex-col">
                    {slot.member ? (
                      <>
                        <span className="text-label-md text-ink">{slot.member.name}</span>
                        <span className="text-caption text-muted-foreground">{slot.member.email}</span>
                      </>
                    ) : slot.invitation ? (
                      <>
                        <span className="text-label-md text-ink">{slot.invitation.invitedName || slot.invitation.email}</span>
                        <span className="text-caption text-muted-foreground">{slot.invitation.email}</span>
                      </>
                    ) : (
                      <span className="text-body-md text-muted-foreground">Open seat</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-sm">
                  <SlotStatus slot={slot} />
                  {slot.invitation?.status === "PENDING" && !slot.member && (
                    <div className="flex gap-xxs">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={resendMutation.isPending}
                        onClick={() => resendMutation.mutate(slot.invitation!.id)}
                      >
                        Resend
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(slot.invitation!.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                  {slot.member && !slot.isHead && (
                    isPaid ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled
                        title="Your team has already paid — contact support to change this seat"
                      >
                        Release seat
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={releaseMutation.isPending}
                        onClick={() => handleRelease(slot)}
                      >
                        Release seat
                      </Button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {isPaid && (
          <section className="flex flex-col gap-md rounded-md border border-border bg-card p-lg">
            <div>
              <h2 className="text-title-lg text-ink">Invite a teammate</h2>
              <p className="text-body-md text-muted-foreground">
                {openSlots.length > 0
                  ? `${openSlots.length} of ${roster.teamSize - 1} teammate seats still need an invitation.`
                  : "Every seat has a pending or accepted invitation."}
              </p>
            </div>
            <form onSubmit={handleInvite} className="grid gap-md sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="invite-name">Name (optional)</Label>
                <Input id="invite-name" value={invitedName} onChange={(e) => setInvitedName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(inviteError) || undefined}
                />
              </div>
              <Button type="submit" disabled={inviteMutation.isPending || openSlots.length === 0}>
                <MailIcon aria-hidden />
                {inviteMutation.isPending ? "Sending…" : "Send invite"}
              </Button>
            </form>
            {inviteError && (
              <p role="alert" className="text-body-md text-destructive-text">
                {inviteError}
              </p>
            )}
          </section>
        )}

        <div>
          <Button variant="outline" render={<Link to="/dashboard" />}>
            Back to your dashboard
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
