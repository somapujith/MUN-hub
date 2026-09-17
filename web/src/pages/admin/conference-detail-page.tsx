import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon, HistoryIcon } from "lucide-react";
import { toast } from "sonner";
import { getAdminMunDetail, publishMun, reinstateMun, suspendMun, unpublishMun } from "@/api/admin-muns";
import { enqueueForGoLive } from "@/api/go-live";
import { setModuleRequirement } from "@/api/module-verification";
import { runLifecycleAction } from "@/api/mun-lifecycle";
import { getPaymentSettings, setPaymentVerificationState } from "@/api/payment-settlement";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Gate2ReviewDialog } from "@/components/admin/gate2-review-dialog";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import { ResultsReviewSection } from "@/components/admin/results-review-section";
import { getRegistrationStatusMeta } from "@/components/dashboard/registration-status";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatAdminDate,
  formatAdminDateRange,
  formatAdminDateTime,
  MODULE_COMPLETION_META,
  MODULE_STATE_META,
  paymentVerificationMeta,
  SLA_META,
  SUBMISSION_STATUS_META,
} from "@/lib/admin/go-live-labels";
import { useAdminPermissions } from "@/lib/admin/permissions";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import type { AdminMunDetail, MunLifecycleAction } from "@/types/admin-muns";
import type { MunModule, MunStatus, RegistrationStatus } from "@/types/enums";
import type { PaymentVerificationState } from "@/types/payment-settlement";

// Statuses in which the public MUN page resolves.
const PUBLIC_STATUSES: MunStatus[] = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "COMPLETED",
  "ARCHIVED",
];

// Statuses in which the Results review section shows: results are with the
// organizer, or waiting for MUNHub.
const RESULTS_REVIEW_STATUSES: MunStatus[] = ["RESULTS_PENDING", "RESULTS_UNDER_REVIEW"];

const SUSPENDABLE: MunStatus[] =["PUBLISHED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CONFERENCE_ACTIVE"];

// Mirrors the lifecycle's ALLOWED_TRANSITIONS: states that can still move to CANCELLED.
const CANCELLABLE: MunStatus[] = [
  "DRAFT",
  "SUBMITTED",
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
  "PUBLISHED",
  "UNPUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "SUSPENDED",
];

const LIFECYCLE_STEPS: Array<{ action: Exclude<MunLifecycleAction, "cancel">; label: string; from: MunStatus[]; confirm: string }> = [
  {
    action: "open-registration",
    label: "Open registration",
    from: ["PUBLISHED"],
    confirm: "Open registration? Delegates can start registering and paying immediately.",
  },
  {
    action: "close-registration",
    label: "Close registration",
    from: ["REGISTRATION_OPEN"],
    confirm: "Close registration? No new delegates can register.",
  },
  {
    action: "start-conference",
    label: "Start conference",
    // From REGISTRATION_OPEN the server closes registration first, as two logged steps.
    from: ["REGISTRATION_OPEN", "REGISTRATION_CLOSED"],
    confirm: "Mark the conference as running?",
  },
  {
    action: "complete",
    label: "Mark completed",
    // Not RESULTS_PENDING: the server refuses that move (results must go
    // through review first; see lib/lifecycle/registration-lifecycle.ts).
    // Not RESULTS_UNDER_REVIEW either: submitted results are completed through
    // the Results review section, whose approval also verifies the awards.
    from: ["CONFERENCE_ACTIVE"],
    confirm: "Mark the conference as completed?",
  },
  {
    action: "archive",
    label: "Archive",
    from: ["COMPLETED"],
    confirm: "Archive this conference?",
  },
];

const REGISTRATION_STATUSES: RegistrationStatus[] = [
  "CONFIRMED",
  "ATTENDED",
  "NO_SHOW",
  "PENDING",
  "PAYMENT_PENDING",
  "CANCELLED",
  "REFUNDED",
];

type PendingDialog = "suspend" | "cancel" | null;

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-md rounded-md border border-border bg-card p-lg">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex flex-col gap-xxs">
          <h2 className="font-display text-title-sm text-ink">{title}</h2>
          {description && <p className="text-body-md text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">{label}</dt>
      <dd className="text-body-md text-ink">{children}</dd>
    </div>
  );
}

/**
 * Staff view of one MUN. Every role can read it and make the Gate 2 content
 * decision while the MUN is in verification. Only ADMIN/SUPER_ADMIN see the
 * actions that change what is public or where the MUN is in its lifecycle
 * (publish, unpublish, suspend, reinstate, registration and conference moves,
 * cancellation), payment-account verification and module requirement
 * toggles — the server refuses them for OPERATIONS regardless.
 */
export function AdminConferenceDetailPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const { canPublish } = useAdminPermissions();
  const [dialog, setDialog] = useState<PendingDialog>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: adminQueryKeys.mun(munId),
    queryFn: () => getAdminMunDetail(munId),
    enabled: Boolean(munId),
  });
  const detail = detailQuery.data;

  // Masked payout details (never the full account number); admins only.
  const paymentDetailsQuery = useQuery({
    queryKey: adminQueryKeys.munPaymentSettings(munId),
    queryFn: () => getPaymentSettings(munId),
    enabled: canPublish && Boolean(detail?.paymentSettings),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.munsAll() }),
      queryClient.invalidateQueries({ queryKey: ["admin", "go-live-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "overview"] }),
    ]);

  const onError = (fallback: string) => (error: unknown) =>
    toast.error(error instanceof Error ? error.message : fallback);

  const visibilityMutation = useMutation({
    mutationFn: async (input: { kind: "publish" | "enqueue" | "unpublish" | "reinstate" } | { kind: "suspend"; reason: string }) => {
      switch (input.kind) {
        case "publish":
          return publishMun(munId);
        case "enqueue":
          return enqueueForGoLive(munId);
        case "unpublish":
          return unpublishMun(munId);
        case "reinstate":
          return reinstateMun(munId);
        case "suspend":
          return suspendMun(munId, input.reason);
      }
    },
    onSuccess: async (_result, input) => {
      await refresh();
      setDialog(null);
      toast.success(
        {
          publish: "Published — the MUN is live",
          enqueue: "Moved to the go-live queue",
          unpublish: "Unpublished",
          reinstate: "Reinstated — the MUN is back in verification",
          suspend: "MUN suspended",
        }[input.kind],
      );
    },
    onError: onError("Unable to update this MUN"),
  });

  const lifecycleMutation = useMutation({
    mutationFn: ({ action, reason }: { action: MunLifecycleAction; reason?: string }) =>
      runLifecycleAction(munId, action, reason),
    onSuccess: async () => {
      await refresh();
      setDialog(null);
      toast.success("Conference status updated");
    },
    onError: onError("Unable to change the conference status"),
  });

  const paymentMutation = useMutation({
    mutationFn: (state: PaymentVerificationState) => setPaymentVerificationState(munId, state),
    onSuccess: async (_result, state) => {
      await refresh();
      toast.success(state === "VERIFIED" ? "Payment account verified" : "Payment account marked as failed");
    },
    onError: onError("Unable to update the payment account"),
  });

  const requirementMutation = useMutation({
    mutationFn: ({ moduleName, isRequired }: { moduleName: MunModule; isRequired: boolean }) =>
      setModuleRequirement(munId, moduleName, isRequired),
    onSuccess: async (_result, { isRequired }) => {
      await refresh();
      toast.success(isRequired ? "Module is now required" : "Module is now optional");
    },
    onError: onError("Unable to change the module requirement"),
  });

  if (detailQuery.isLoading) {
    return (
      <AdminPageFrame title="Conference" description="Loading…">
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      </AdminPageFrame>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <AdminPageFrame title="Conference" description="This conference could not be loaded.">
        <p className="text-body-md text-destructive">
          {detailQuery.error instanceof Error ? detailQuery.error.message : "Conference not found."}
        </p>
        <Button variant="outline" size="sm" className="self-start" render={<Link to="/admin/muns" />}>
          <ArrowLeftIcon aria-hidden /> All conferences
        </Button>
      </AdminPageFrame>
    );
  }

  const { mun, submission } = detail;
  const status = mun.status;
  const busy = visibilityMutation.isPending || lifecycleMutation.isPending;
  const canReview = status === "VERIFICATION" && submission?.active === true;

  const confirmThen = (message: string, run: () => void) => {
    if (window.confirm(message)) run();
  };

  const visibilityButtons: ReactNode[] = [];
  if (status === "GO_LIVE_QUEUE" || (status === "VERIFIED" && !submission?.active)) {
    visibilityButtons.push(
      <Button
        key="publish"
        size="sm"
        disabled={busy || detail.paymentSettings?.verificationState !== "VERIFIED"}
        onClick={() =>
          confirmThen(`Publish ${mun.name}? It will go live on the public marketplace immediately.`, () =>
            visibilityMutation.mutate({ kind: "publish" }),
          )
        }
      >
        Publish
      </Button>,
    );
  }
  if (status === "VERIFIED" && submission?.active) {
    visibilityButtons.push(
      <Button key="enqueue" size="sm" variant="outline" disabled={busy} onClick={() => visibilityMutation.mutate({ kind: "enqueue" })}>
        Queue for go-live
      </Button>,
    );
  }
  if (status === "UNPUBLISHED") {
    // The server opens a fresh approved submission for a MUN that was
    // published before (lib/lifecycle/go-live.ts#enqueueForGoLive), and
    // refuses while a required section still needs review.
    visibilityButtons.push(
      <Button key="requeue" size="sm" variant="outline" disabled={busy} onClick={() => visibilityMutation.mutate({ kind: "enqueue" })}>
        Queue for go-live
      </Button>,
    );
  }
  if (status === "PUBLISHED") {
    visibilityButtons.push(
      <Button
        key="unpublish"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          confirmThen(`Unpublish ${mun.name}? It disappears from the marketplace until it is published again.`, () =>
            visibilityMutation.mutate({ kind: "unpublish" }),
          )
        }
      >
        Unpublish
      </Button>,
    );
  }
  if (SUSPENDABLE.includes(status)) {
    visibilityButtons.push(
      <Button key="suspend" size="sm" variant="destructive" disabled={busy} onClick={() => setDialog("suspend")}>
        Suspend
      </Button>,
    );
  }
  if (status === "SUSPENDED") {
    visibilityButtons.push(
      <Button
        key="reinstate"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          confirmThen(`Reinstate ${mun.name}? It goes back to verification before it can go live again.`, () =>
            visibilityMutation.mutate({ kind: "reinstate" }),
          )
        }
      >
        Reinstate
      </Button>,
    );
  }

  const lifecycleButtons = LIFECYCLE_STEPS.filter((step) => step.from.includes(status)).map((step) => (
    <Button
      key={step.action}
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => confirmThen(step.confirm, () => lifecycleMutation.mutate({ action: step.action }))}
    >
      {step.label}
    </Button>
  ));
  if (CANCELLABLE.includes(status)) {
    lifecycleButtons.push(
      <Button key="cancel" size="sm" variant="destructive" disabled={busy} onClick={() => setDialog("cancel")}>
        Cancel conference
      </Button>,
    );
  }

  const payment = paymentVerificationMeta(detail.paymentSettings?.verificationState ?? null);
  const paymentDetails = paymentDetailsQuery.data;

  return (
    <AdminPageFrame title={mun.name} description={`${mun.slug}${mun.edition ? ` · ${mun.edition}` : ""}`}>
      <div className="flex flex-wrap items-center gap-sm">
        <Button variant="outline" size="sm" render={<Link to="/admin/muns" />}>
          <ArrowLeftIcon aria-hidden /> All conferences
        </Button>
        <Button variant="outline" size="sm" render={<Link to={`/admin/audit/mun/${mun.id}`} />}>
          <HistoryIcon aria-hidden /> Audit trail
        </Button>
        {PUBLIC_STATUSES.includes(status) && (
          <Button variant="outline" size="sm" render={<Link to={`/mun/${mun.slug}`} target="_blank" rel="noreferrer" />}>
            <ExternalLinkIcon aria-hidden /> Public page
          </Button>
        )}
      </div>

      <Section title="Overview">
        <dl className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Status">
            <MunStatusBadge status={status} />
          </Fact>
          <Fact label="Organizer">
            <span className="block">{detail.organizer.name}</span>
            <span className="block break-all text-muted-foreground">{detail.organizer.email}</span>
            {detail.organizer.suspended && <Badge variant="destructive">Account suspended</Badge>}
          </Fact>
          <Fact label="Conference dates">{formatAdminDateRange(mun.startDate, mun.endDate)}</Fact>
          <Fact label="Location">{[mun.venue, mun.city, mun.country].filter(Boolean).join(", ") || "—"}</Fact>
          <Fact label="Registration window">{formatAdminDateRange(mun.registrationOpensAt, mun.registrationDeadline)}</Fact>
          <Fact label="Published">{formatAdminDate(mun.publishedAt)}</Fact>
          <Fact label="Created">{formatAdminDate(mun.createdAt)}</Fact>
          <Fact label="Application (Gate 1)">
            {detail.application
              ? `${detail.application.status.toLowerCase().replace(/_/g, " ")} · ${formatAdminDate(detail.application.submittedAt)}`
              : "No application"}
          </Fact>
        </dl>
      </Section>

      <Section
        title="Actions"
        description={
          canPublish
            ? "Every action is recorded in the audit trail. The server re-checks whether it is allowed from the current status."
            : "Publishing, suspension and lifecycle changes need an admin. You can still make the content-review decision."
        }
      >
        <div className="flex flex-col gap-md">
          {canReview && (
            <div className="flex flex-wrap items-center gap-sm">
              <Button size="sm" onClick={() => setReviewOpen(true)}>
                Review submission
              </Button>
              <span className="text-body-md text-muted-foreground">Gate 2: approve, request changes or reject.</span>
            </div>
          )}
          {canPublish && (
            <>
              <div className="flex flex-col gap-xs">
                <h3 className="text-body-md font-medium text-ink">Visibility</h3>
                {visibilityButtons.length > 0 ? (
                  <div className="flex flex-wrap gap-sm">{visibilityButtons}</div>
                ) : (
                  <p className="text-body-md text-muted-foreground">Nothing to change from this status.</p>
                )}
                {(status === "GO_LIVE_QUEUE" || (status === "VERIFIED" && !submission?.active)) &&
                  detail.paymentSettings?.verificationState !== "VERIFIED" && (
                    <p className="text-body-md text-muted-foreground">Verify the payment account before publishing.</p>
                  )}
              </div>
              <div className="flex flex-col gap-xs">
                <h3 className="text-body-md font-medium text-ink">Lifecycle</h3>
                {lifecycleButtons.length > 0 ? (
                  <div className="flex flex-wrap gap-sm">{lifecycleButtons}</div>
                ) : (
                  <p className="text-body-md text-muted-foreground">
                    {RESULTS_REVIEW_STATUSES.includes(status)
                      ? "The conference completes once its results are approved in Results review below."
                      : "This conference has reached the end of its lifecycle."}
                  </p>
                )}
              </div>
            </>
          )}
          {!canPublish && !canReview && (
            <p className="text-body-md text-muted-foreground">
              {status === "RESULTS_UNDER_REVIEW"
                ? "The conference results are waiting for review below."
                : "No review decision is pending."}
            </p>
          )}
        </div>
      </Section>

      {RESULTS_REVIEW_STATUSES.includes(status) && (
        <ResultsReviewSection munId={mun.id} munName={mun.name} status={status} onDecided={refresh} />
      )}

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
        <Section title="Current submission" description="The latest Gate 2 content submission.">
          {submission ? (
            <dl className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <Fact label="Submission">
                <Badge variant={SUBMISSION_STATUS_META[submission.status].variant}>
                  {SUBMISSION_STATUS_META[submission.status].label}
                </Badge>{" "}
                <span className="text-muted-foreground">v{submission.versionNumber}</span>
              </Fact>
              <Fact label="SLA">
                <Badge variant={SLA_META[submission.slaState].variant}>{SLA_META[submission.slaState].label}</Badge>{" "}
                <span className="text-muted-foreground">due {formatAdminDate(submission.slaDeadline)}</span>
              </Fact>
              <Fact label="Submitted">{formatAdminDateTime(submission.submittedAt)}</Fact>
              <Fact label="Reviewer">{submission.reviewerName ?? "Unassigned"}</Fact>
              <Fact label="Decided">{formatAdminDateTime(submission.decidedAt)}</Fact>
              <Fact label="Published">{formatAdminDateTime(submission.publishedAt)}</Fact>
              {submission.rejectionReason && <Fact label="Rejection reason">{submission.rejectionReason}</Fact>}
            </dl>
          ) : (
            <p className="text-body-md text-muted-foreground">The organizer hasn&apos;t submitted this MUN for review yet.</p>
          )}
        </Section>

        <Section
          title="Payment account"
          description="Checked off-platform by MUNHub. Publishing is blocked until it is verified."
          action={<Badge variant={payment.variant}>{payment.label}</Badge>}
        >
          {detail.paymentSettings ? (
            <div className="flex flex-col gap-md">
              <dl className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <Fact label="Verified">
                  {detail.paymentSettings.verifiedAt
                    ? `${formatAdminDateTime(detail.paymentSettings.verifiedAt)}${detail.paymentSettings.verifiedByName ? ` by ${detail.paymentSettings.verifiedByName}` : ""}`
                    : "—"}
                </Fact>
                <Fact label="Details last changed">{formatAdminDateTime(detail.paymentSettings.updatedAt)}</Fact>
                {paymentDetails && (
                  <>
                    <Fact label="Legal name">{paymentDetails.legalName}</Fact>
                    <Fact label="Account holder">{paymentDetails.accountHolderName}</Fact>
                    <Fact label="Bank">
                      {paymentDetails.bankName} · ending {paymentDetails.accountNumberLast4}
                    </Fact>
                    <Fact label="IFSC">{paymentDetails.ifsc}</Fact>
                    <Fact label="PAN">ending {paymentDetails.panLast4}</Fact>
                    <Fact label="GSTIN">{paymentDetails.gstin ?? "—"}</Fact>
                  </>
                )}
              </dl>
              {canPublish && (
                <div className="flex flex-wrap gap-sm">
                  {detail.paymentSettings.verificationState !== "VERIFIED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={paymentMutation.isPending}
                      onClick={() =>
                        confirmThen("Mark this payout account as verified? Only after checking it off-platform.", () =>
                          paymentMutation.mutate("VERIFIED"),
                        )
                      }
                    >
                      Verify account
                    </Button>
                  )}
                  {detail.paymentSettings.verificationState !== "FAILED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={paymentMutation.isPending}
                      onClick={() =>
                        confirmThen("Mark this payout account as failed? The organizer must fix their details.", () =>
                          paymentMutation.mutate("FAILED"),
                        )
                      }
                    >
                      Reject account
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-body-md text-muted-foreground">The organizer hasn&apos;t submitted payout details yet.</p>
          )}
        </Section>
      </div>

      <Section title="Registrations">
        <dl className="grid grid-cols-2 gap-md sm:grid-cols-4 lg:grid-cols-7">
          {REGISTRATION_STATUSES.map((registrationStatus) => (
            <Fact key={registrationStatus} label={getRegistrationStatusMeta(registrationStatus).label}>
              <span className="font-display text-title-md tabular-nums">
                {detail.registrationCounts[registrationStatus] ?? 0}
              </span>
            </Fact>
          ))}
        </dl>
      </Section>

      <ModulesSection
        detail={detail}
        canToggle={canPublish}
        pendingModule={requirementMutation.isPending ? requirementMutation.variables?.moduleName : undefined}
        onToggle={(moduleName, isRequired) => requirementMutation.mutate({ moduleName, isRequired })}
      />

      <Section title="History" description="Lifecycle transitions and admin actions on this MUN, newest first.">
        {detail.history.length === 0 ? (
          <p className="text-body-md text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {detail.history.map((entry) => (
              <li key={`${entry.source}-${entry.id}`} className="flex flex-col gap-xxs py-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-xs">
                  <span className="font-medium text-ink">{entry.action}</span>
                  <Badge variant="outline">{entry.source === "lifecycle" ? "Status change" : "Admin action"}</Badge>
                </div>
                <p className="text-body-md text-muted-foreground">
                  {formatAdminDateTime(entry.createdAt)} · {entry.actorName ?? entry.actorId}
                </p>
                {entry.notes && <p className="text-body-md text-body">{entry.notes}</p>}
                {entry.internalNotes && (
                  <p className="text-body-md text-muted-foreground">Internal: {entry.internalNotes}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Gate2ReviewDialog
        target={reviewOpen ? { munId: mun.id, munName: mun.name } : null}
        onClose={() => setReviewOpen(false)}
        onDecided={refresh}
      />
      <ReasonDialog
        open={dialog === "suspend"}
        title={`Suspend ${mun.name}`}
        description="Hides the MUN and stops new registrations. Reinstating sends it back through verification."
        confirmLabel="Suspend MUN"
        pendingLabel="Suspending…"
        isPending={visibilityMutation.isPending}
        onConfirm={(reason) => visibilityMutation.mutate({ kind: "suspend", reason })}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        title={`Cancel ${mun.name}`}
        description="Cancelling is final. Existing delegates will need to be contacted; payment problems are handled as payment exceptions."
        confirmLabel="Cancel conference"
        pendingLabel="Cancelling…"
        isPending={lifecycleMutation.isPending}
        onConfirm={(reason) => lifecycleMutation.mutate({ action: "cancel", reason })}
        onClose={() => setDialog(null)}
      />
    </AdminPageFrame>
  );
}

function ModulesSection({
  detail,
  canToggle,
  pendingModule,
  onToggle,
}: {
  detail: AdminMunDetail;
  canToggle: boolean;
  pendingModule: MunModule | undefined;
  onToggle: (moduleName: MunModule, isRequired: boolean) => void;
}) {
  return (
    <Section
      title="Modules"
      description={
        canToggle
          ? "Completion is the organizer's progress; verification is MUNHub's review. Optional modules don't block submission."
          : "Completion is the organizer's progress; verification is MUNHub's review."
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-body-md">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="py-sm pr-md font-medium">Module</th>
              <th className="py-sm pr-md font-medium">Required</th>
              <th className="py-sm pr-md font-medium">Completion</th>
              <th className="py-sm pr-md font-medium">Verification</th>
              <th className="py-sm font-medium">Last reviewed</th>
            </tr>
          </thead>
          <tbody>
            {detail.modules.map((module) => {
              const completion = MODULE_COMPLETION_META[module.completionStatus];
              const state = MODULE_STATE_META[module.state];
              const checkboxId = `module-required-${module.moduleName}`;
              // FINAL_REVIEW can never be optional (server rule).
              const locked = module.moduleName === "FINAL_REVIEW";
              return (
                <tr key={module.moduleName} className="border-b border-border last:border-0">
                  <td className="py-sm pr-md">
                    <span className="font-medium text-ink">{module.label}</span>
                    {module.blockingIssueCount > 0 && (
                      <span className="block text-body-md text-destructive">
                        {module.blockingIssueCount} blocking {module.blockingIssueCount === 1 ? "issue" : "issues"}
                      </span>
                    )}
                  </td>
                  <td className="py-sm pr-md">
                    {canToggle ? (
                      <div className="flex items-center gap-xs">
                        <Checkbox
                          id={checkboxId}
                          checked={module.isRequired}
                          disabled={locked || pendingModule === module.moduleName}
                          onCheckedChange={(checked) => onToggle(module.moduleName, checked === true)}
                        />
                        <label htmlFor={checkboxId} className="text-body-md text-ink">
                          {module.isRequired ? "Required" : "Optional"}
                          <span className="sr-only"> — {module.label}</span>
                        </label>
                      </div>
                    ) : (
                      <span className="text-ink">{module.isRequired ? "Required" : "Optional"}</span>
                    )}
                  </td>
                  <td className="py-sm pr-md">
                    <Badge variant={completion.variant}>{completion.label}</Badge>{" "}
                    <span className="tabular-nums text-muted-foreground">{module.completionPercentage}%</span>
                  </td>
                  <td className="py-sm pr-md">
                    <Badge variant={state.variant}>{state.label}</Badge>
                  </td>
                  <td className="py-sm text-muted-foreground">
                    {module.lastReviewedAt
                      ? `${formatAdminDate(module.lastReviewedAt)}${module.lastReviewedByName ? ` · ${module.lastReviewedByName}` : ""}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
