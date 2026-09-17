import { useState, useEffect, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Ban, CalendarClock, CircleCheck, Save, Wallet } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { getMunContact, upsertMunContact } from "@/api/mun-contact";
import {
  getMunLifecycle,
  munLifecycleQueryKey,
  runLifecycleAction,
  type LifecycleAction,
  type LifecycleActionOption,
  type MunLifecycleOverview,
} from "@/api/mun-lifecycle";
import { getOrganizerOnboarding, savePaymentStep } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { MunStatus } from "@/types/enums";
import type { UpsertMunContactInput } from "@/types/mun-contact";

const EMPTY_FORM: UpsertMunContactInput = {
  officialEmail: "",
  phone: "",
  website: "",
  socialLinks: null,
  contactPersonName: "",
  contactPersonRole: "",
  contactPersonEmail: "",
  contactPersonPhone: "",
};

// Mirrors lib/lifecycle/registration-lifecycle.ts#CANCEL_REASON_MAX_LENGTH.
const CANCEL_REASON_MAX_LENGTH = 1000;

// The lifecycle rules are evaluated in Indian Standard Time on the server, so
// dates here are shown in IST too, whatever the browser's own time zone is.
const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const IST_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatIstDate(iso: string | null): string {
  return iso ? IST_DATE.format(new Date(iso)) : "Not set";
}

function formatIstDateTime(iso: string | null): string {
  return iso ? `${IST_DATE_TIME.format(new Date(iso))} IST` : "Not set";
}

interface ActionCopy {
  label: string;
  title: string;
  description: (overview: MunLifecycleOverview) => string;
  confirmLabel: string;
  pendingLabel: string;
  successMessage: string;
}

type StepAction = Exclude<LifecycleAction, "cancel">;

const ACTION_COPY: Record<StepAction, ActionCopy> = {
  "open-registration": {
    label: "Open registration",
    title: "Open registration?",
    description: (overview) =>
      `Delegates can register and pay for passes straight away. Registration closes automatically after the deadline (${formatIstDateTime(overview.registrationDeadline)}).`,
    confirmLabel: "Open registration",
    pendingLabel: "Opening...",
    successMessage: "Registration is open",
  },
  "close-registration": {
    label: "Close registration",
    title: "Close registration?",
    description: () =>
      "New delegates won't be able to register. Anyone already in checkout can still finish paying for the seat they are holding.",
    confirmLabel: "Close registration",
    pendingLabel: "Closing...",
    successMessage: "Registration is closed",
  },
  "start-conference": {
    label: "Start conference",
    title: "Start the conference?",
    description: (overview) =>
      overview.status === "REGISTRATION_OPEN"
        ? "Registration closes and the conference is marked as in progress."
        : "The conference is marked as in progress.",
    confirmLabel: "Start conference",
    pendingLabel: "Starting...",
    successMessage: "The conference is in progress",
  },
  complete: {
    label: "Mark conference complete",
    title: "Mark the conference complete?",
    description: () => "This ends the conference on MUNHub. A completed conference can't be reopened.",
    confirmLabel: "Mark complete",
    pendingLabel: "Completing...",
    successMessage: "The conference is complete",
  },
  archive: {
    label: "Archive conference",
    title: "Archive this conference?",
    description: () => "Archived conferences are kept for the record and can't be changed.",
    confirmLabel: "Archive",
    pendingLabel: "Archiving...",
    successMessage: "The conference is archived",
  },
};

// What the scheduled lifecycle job (lib/lifecycle/registration-lifecycle.ts#
// runScheduledLifecycleTransitions) will do next for this conference, if anything.
function scheduleNote(overview: MunLifecycleOverview): string | null {
  const now = Date.now();
  const isFuture = (iso: string | null): iso is string => iso !== null && new Date(iso).getTime() > now;
  if (overview.status === "PUBLISHED" && isFuture(overview.registrationOpensAt)) {
    return `Registration opens automatically on ${formatIstDateTime(overview.registrationOpensAt)}.`;
  }
  if (overview.status === "REGISTRATION_OPEN" && isFuture(overview.registrationDeadline)) {
    return `Registration closes automatically after ${formatIstDateTime(overview.registrationDeadline)}.`;
  }
  if (overview.status === "REGISTRATION_CLOSED" && isFuture(overview.startDate)) {
    return `The conference starts automatically on ${formatIstDate(overview.startDate)}.`;
  }
  return null;
}

// Shown when the current status has no next step for the organizer.
const NO_ACTION_MESSAGES: Partial<Record<MunStatus, string>> = {
  RESULTS_PENDING: "Results are being prepared for this conference.",
  RESULTS_UNDER_REVIEW: "Results are under MUNHub review. MUNHub completes the conference once they are approved.",
  COMPLETED: "This conference is complete.",
  ARCHIVED: "This conference is archived.",
  CANCELLED: "This conference has been cancelled.",
  SUSPENDED: "MUNHub has suspended this conference. Contact MUNHub support for next steps.",
  UNPUBLISHED: "This conference is not listed on MUNHub right now.",
  REJECTED: "This application was not approved.",
};

// Dates can no longer change anything for these, so the Setup link is hidden.
const FINISHED_STATUSES = new Set<MunStatus>(["COMPLETED", "ARCHIVED", "CANCELLED", "REJECTED"]);

const PRE_LAUNCH_STATUSES = new Set<MunStatus>([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
  "ONBOARDING",
  "ACTION_REQUIRED",
  "READY_FOR_SUBMISSION",
  "CONTENT_SUBMITTED",
  "AUTOMATED_VALIDATION",
  "ORGANIZER_CONFIRMATION",
  "VERIFICATION",
  "VERIFIED",
  "GO_LIVE_QUEUE",
  "PUBLISHING",
]);

function LifecycleCard({ munId }: { munId: string }) {
  const queryClient = useQueryClient();
  // The dialog's action is kept after it closes so its copy doesn't vanish
  // mid close-animation; `actionDialogOpen` alone controls visibility.
  const [dialogAction, setDialogAction] = useState<StepAction>("open-registration");
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelConfirmName, setCancelConfirmName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const lifecycleQuery = useQuery({
    queryKey: munLifecycleQueryKey(munId),
    queryFn: () => getMunLifecycle(munId),
    enabled: Boolean(munId),
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, reason }: { action: LifecycleAction; reason?: string }) =>
      runLifecycleAction(munId, action, reason),
    onSuccess: async (_result, { action }) => {
      setActionDialogOpen(false);
      setCancelOpen(false);
      toast.success(action === "cancel" ? "The conference is cancelled" : ACTION_COPY[action].successMessage);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: munLifecycleQueryKey(munId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.munSetupDetails(munId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.organizerWorkspace() }),
      ]);
    },
    onError: async (error) => {
      setDialogError(error instanceof Error ? error.message : "Something went wrong — try again");
      // The mun may have moved on (e.g. the scheduler closed registration):
      // refresh so the card shows what is actually possible now.
      await queryClient.invalidateQueries({ queryKey: munLifecycleQueryKey(munId) });
    },
  });

  if (lifecycleQuery.isLoading) {
    return <Skeleton className="h-[260px] w-full max-w-2xl rounded-md" />;
  }
  if (lifecycleQuery.isError) {
    return <p className="text-body-md text-destructive">{lifecycleQuery.error.message}</p>;
  }
  const overview = lifecycleQuery.data;
  if (!overview) return null;

  const stepActions = overview.actions.filter(
    (option): option is LifecycleActionOption & { action: StepAction } => option.action !== "cancel",
  );
  const cancelOption = overview.actions.find((option) => option.action === "cancel");
  const primaryAction = stepActions.find((option) => option.available)?.action;
  const note = scheduleNote(overview);
  const nameMatches = cancelConfirmName.trim() === overview.name.trim();
  const reasonReady = cancelReason.trim().length > 0;
  const dialogCopy = ACTION_COPY[dialogAction];

  const openActionDialog = (action: StepAction) => {
    setDialogError(null);
    setDialogAction(action);
    setActionDialogOpen(true);
  };

  const openCancelDialog = () => {
    setDialogError(null);
    setCancelReason("");
    setCancelConfirmName("");
    setCancelOpen(true);
  };

  const handleCancelSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reasonReady || !nameMatches) return;
    setDialogError(null);
    actionMutation.mutate({ action: "cancel", reason: cancelReason.trim() });
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Registration &amp; lifecycle</CardTitle>
        <CardDescription>Open and close registration, run the conference, and wrap it up.</CardDescription>
        <CardAction>
          <MunStatusBadge status={overview.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-lg">
        <div className="flex flex-col gap-sm">
          <dl className="grid gap-md sm:grid-cols-2">
            <div className="flex flex-col gap-xxs">
              <dt className="text-caption text-muted-foreground">Registration opens</dt>
              <dd className="text-body-md text-ink">{formatIstDateTime(overview.registrationOpensAt)}</dd>
            </div>
            <div className="flex flex-col gap-xxs">
              <dt className="text-caption text-muted-foreground">Registration deadline</dt>
              <dd className="text-body-md text-ink">{formatIstDateTime(overview.registrationDeadline)}</dd>
            </div>
            <div className="flex flex-col gap-xxs">
              <dt className="text-caption text-muted-foreground">Conference starts</dt>
              <dd className="text-body-md text-ink">{formatIstDate(overview.startDate)}</dd>
            </div>
            <div className="flex flex-col gap-xxs">
              <dt className="text-caption text-muted-foreground">Conference ends</dt>
              <dd className="text-body-md text-ink">{formatIstDate(overview.endDate)}</dd>
            </div>
          </dl>
          {!FINISHED_STATUSES.has(overview.status) && (
            <p className="flex flex-wrap items-center gap-x-xs gap-y-xxs text-body-md text-muted-foreground">
              <CalendarClock aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
              {note && <span>{note}</span>}
              <Link
                to={`/organizer/dashboard/${munId}/setup`}
                className="text-body-md text-link underline-offset-4 hover:underline"
              >
                Change dates in Setup
              </Link>
            </p>
          )}
        </div>

        {stepActions.length > 0 ? (
          <ul className="flex flex-col gap-sm" aria-label="Next steps">
            {stepActions.map((option) => (
              <li key={option.action} className="flex flex-col gap-xxs">
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant={option.action === primaryAction ? "default" : "outline"}
                    disabled={!option.available || actionMutation.isPending}
                    aria-describedby={option.blockedReason ? `lifecycle-${option.action}-reason` : undefined}
                    onClick={() => openActionDialog(option.action)}
                  >
                    {ACTION_COPY[option.action].label}
                  </Button>
                </div>
                {option.blockedReason && (
                  <p id={`lifecycle-${option.action}-reason`} className="text-body-md text-muted-foreground">
                    {option.blockedReason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-muted-foreground">
            {PRE_LAUNCH_STATUSES.has(overview.status)
              ? "Registration controls appear here once MUNHub has published your conference."
              : (NO_ACTION_MESSAGES[overview.status] ?? "There is nothing to change for this conference right now.")}
          </p>
        )}

        {cancelOption && (
          <div className="flex flex-col gap-sm border-t border-border pt-lg">
            <div className="flex flex-col gap-xxs">
              <h2 className="font-display text-title-sm text-ink">Cancel conference</h2>
              <p className="text-body-md text-muted-foreground">
                Withdraws the conference from MUNHub and closes registration for good. Confirmed delegates keep
                their registrations — MUNHub does not issue refunds.
              </p>
            </div>
            <div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!cancelOption.available || actionMutation.isPending}
                onClick={openCancelDialog}
              >
                <Ban aria-hidden />
                Cancel conference
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={actionDialogOpen}
        onOpenChange={(open) => {
          if (!open && !actionMutation.isPending) setActionDialogOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogCopy.title}</DialogTitle>
            <DialogDescription>{dialogCopy.description(overview)}</DialogDescription>
          </DialogHeader>
          {dialogError && (
            <p role="alert" className="text-body-md text-destructive">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => setActionDialogOpen(false)}
            >
              Not now
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={actionMutation.isPending}
              onClick={() => {
                setDialogError(null);
                actionMutation.mutate({ action: dialogAction });
              }}
            >
              {actionMutation.isPending ? dialogCopy.pendingLabel : dialogCopy.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!open && !actionMutation.isPending) setCancelOpen(false);
        }}
      >
        <DialogContent>
          <form onSubmit={handleCancelSubmit} className="flex flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>Cancel {overview.name}?</DialogTitle>
              <DialogDescription>
                This can't be undone. The conference is withdrawn from MUNHub and registration closes.{" "}
                {overview.confirmedRegistrations === 1
                  ? "1 confirmed delegate keeps their registration."
                  : `${overview.confirmedRegistrations} confirmed delegates keep their registrations.`}{" "}
                MUNHub does not issue refunds.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="cancel-reason">Reason</Label>
              <textarea
                id="cancel-reason"
                className="min-h-20 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                value={cancelReason}
                maxLength={CANCEL_REASON_MAX_LENGTH}
                onChange={(event) => setCancelReason(event.target.value)}
                aria-describedby="cancel-reason-help"
                required
                autoFocus
              />
              <p id="cancel-reason-help" className="text-caption text-muted-foreground">
                Recorded with the cancellation and may be shared with registered delegates.
              </p>
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="cancel-confirm-name">
                Type <span className="font-medium text-ink">{overview.name}</span> to confirm
              </Label>
              <Input
                id="cancel-confirm-name"
                value={cancelConfirmName}
                onChange={(event) => setCancelConfirmName(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            {dialogError && (
              <p role="alert" className="text-body-md text-destructive">
                {dialogError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionMutation.isPending}
                onClick={() => setCancelOpen(false)}
              >
                Keep conference
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={actionMutation.isPending || !reasonReady || !nameMatches}
              >
                {actionMutation.isPending ? "Cancelling..." : "Cancel conference"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// MUN Hub only accepts payouts to a FreeCharge UPI handle (@freecharge) —
// user-directed restriction, mirrors lib/actions/organizer-onboarding.ts's UPI_PATTERN.
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@freecharge$/;

/**
 * Payout details for this organizer account (not per-MUN): a UPI ID plus the
 * mobile number linked to it, set once during onboarding
 * (lib/actions/organizer-onboarding.ts#saveOrganizerPaymentStep). That step
 * locks once onboarding completes, so once set this only shows a
 * confirmation, never the stored value — changing it goes through support.
 */
function PaymentDetailsCard() {
  const [upiId, setUpiId] = useState("");
  const [upiPhone, setUpiPhone] = useState("");

  const onboardingQuery = useQuery({
    queryKey: queryKeys.organizerOnboarding(),
    queryFn: getOrganizerOnboarding,
  });

  const saveMutation = useMutation({
    mutationFn: () => savePaymentStep({ upiId: upiId.trim(), upiPhone: upiPhone.trim() }),
    onSuccess: async () => {
      toast.success("Payment details added");
      await onboardingQuery.refetch();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save payment details"),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!UPI_PATTERN.test(upiId.trim())) {
      toast.error("Only a FreeCharge UPI ID is accepted — it must look like name@freecharge");
      return;
    }
    if (!upiPhone.trim()) {
      toast.error("Mobile number is required");
      return;
    }
    saveMutation.mutate();
  };

  const hasPaymentDetails = Boolean(onboardingQuery.data?.profile.upiId);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          Where MUNHub sends your payout once the conference is settled. We only accept a FreeCharge UPI ID — create
          a FreeCharge UPI account, link your bank account to it, then submit that UPI ID below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        {onboardingQuery.isLoading ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : onboardingQuery.isError ? (
          <p className="text-body-md text-destructive">{onboardingQuery.error.message}</p>
        ) : hasPaymentDetails ? (
          <div className="flex items-center gap-sm rounded-md border border-border bg-card px-md py-sm">
            <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
            <div>
              <p className="text-body-md font-medium text-ink">Payment details on file</p>
              <p className="text-body-md text-muted-foreground">
                To change your UPI ID or mobile number, contact MUNHub support.
              </p>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-md" onSubmit={handleSubmit}>
            <div className="grid gap-md sm:grid-cols-2">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="payment-upi-id">FreeCharge UPI ID</Label>
                <Input
                  id="payment-upi-id"
                  placeholder="name@freecharge"
                  value={upiId}
                  onChange={(event) => setUpiId(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-xs">
                <Label htmlFor="payment-upi-phone">Mobile number linked to it</Label>
                <Input
                  id="payment-upi-phone"
                  type="tel"
                  value={upiPhone}
                  onChange={(event) => setUpiPhone(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                <Wallet aria-hidden />
                {saveMutation.isPending ? "Saving..." : "Add payment details"}
              </Button>
            </div>
          </form>
        )}
        <p className="border-t border-border pt-md text-body-md text-muted-foreground">
          Transactions and invoices are settled after your MUN is completed.
        </p>
      </CardContent>
    </Card>
  );
}

export function OrganizerSettingsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UpsertMunContactInput>(EMPTY_FORM);

  const contactQuery = useQuery({
    queryKey: queryKeys.munContact(munId),
    queryFn: () => getMunContact(munId),
    enabled: Boolean(munId),
  });

  useEffect(() => {
    const contact = contactQuery.data;
    if (!contact) return;
    setForm({
      officialEmail: contact.officialEmail,
      phone: contact.phone ?? "",
      website: contact.website ?? "",
      socialLinks: contact.socialLinks,
      contactPersonName: contact.contactPersonName,
      contactPersonRole: contact.contactPersonRole ?? "",
      contactPersonEmail: contact.contactPersonEmail,
      contactPersonPhone: contact.contactPersonPhone ?? "",
    });
  }, [contactQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertMunContact(munId, {
        ...form,
        phone: form.phone || null,
        website: form.website || null,
        contactPersonRole: form.contactPersonRole || null,
        contactPersonPhone: form.contactPersonPhone || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.munContact(munId) });
      toast.success("Contact info saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save contact info"),
  });

  const socialLink = (form.socialLinks && Object.values(form.socialLinks)[0]) ?? "";

  return (
    <>
      <Helmet title="Settings" />
      <WorkspacePage
        title="Settings"
        description="Registration and conference status, plus the official contact details shown to delegates and MUNHub reviewers."
      >
        <LifecycleCard munId={munId} />
        <PaymentDetailsCard />
        {contactQuery.isLoading ? (
          <Skeleton className="h-[420px] w-full max-w-2xl rounded-md" />
        ) : contactQuery.isError ? (
          <p className="text-body-md text-destructive">{contactQuery.error.message}</p>
        ) : (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Conference contact</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-md"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !form.officialEmail.trim() ||
                    !form.contactPersonName.trim() ||
                    !form.contactPersonEmail.trim()
                  ) {
                    toast.error("Official email, contact name, and contact email are required");
                    return;
                  }
                  saveMutation.mutate();
                }}
              >
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-official-email">Official email</Label>
                    <Input
                      id="contact-official-email"
                      type="email"
                      value={form.officialEmail}
                      onChange={(event) => setForm({ ...form, officialEmail: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-phone">Phone</Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      value={form.phone ?? ""}
                      onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-website">Website</Label>
                    <Input
                      id="contact-website"
                      type="url"
                      value={form.website ?? ""}
                      onChange={(event) => setForm({ ...form, website: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-social">Social link</Label>
                    <Input
                      id="contact-social"
                      type="url"
                      value={socialLink}
                      onChange={(event) =>
                        setForm({ ...form, socialLinks: event.target.value ? { primary: event.target.value } : null })
                      }
                    />
                  </div>
                </div>
                <hr className="border-border" />
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-name">Contact person</Label>
                    <Input
                      id="contact-person-name"
                      value={form.contactPersonName}
                      onChange={(event) => setForm({ ...form, contactPersonName: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-role">Role</Label>
                    <Input
                      id="contact-person-role"
                      value={form.contactPersonRole ?? ""}
                      onChange={(event) => setForm({ ...form, contactPersonRole: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-md sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-email">Contact email</Label>
                    <Input
                      id="contact-person-email"
                      type="email"
                      value={form.contactPersonEmail}
                      onChange={(event) => setForm({ ...form, contactPersonEmail: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="contact-person-phone">Contact phone</Label>
                    <Input
                      id="contact-person-phone"
                      type="tel"
                      value={form.contactPersonPhone ?? ""}
                      onChange={(event) => setForm({ ...form, contactPersonPhone: event.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                    <Save aria-hidden />
                    {saveMutation.isPending ? "Saving..." : "Save contact info"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </WorkspacePage>
    </>
  );
}
