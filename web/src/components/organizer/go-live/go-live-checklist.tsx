import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleIcon,
  HourglassIcon,
  InfoIcon,
  LockIcon,
  PencilIcon,
  SendIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { confirmModule } from "@/api/module-verification";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPLETION_STATUS_LABEL,
  MODULE_SECTION,
  VERIFICATION_STATE_LABEL,
  canSendModuleForReview,
} from "@/lib/organizer/go-live";
import { getMunNavSection, munSectionHref } from "@/lib/organizer/nav-config";
import type { MunModule } from "@/types/enums";
import type { ModuleProgressSummary } from "@/types/go-live";

const COMPLETION_VARIANT: Record<string, "success" | "warning" | "secondary" | "info"> = {
  COMPLETE: "success",
  ACTION_REQUIRED: "warning",
  IN_PROGRESS: "secondary",
  NOT_STARTED: "secondary",
  LOCKED: "info",
};

const VERIFICATION_VARIANT: Record<string, "success" | "warning" | "secondary" | "info" | "destructive"> = {
  NOT_SUBMITTED: "secondary",
  PENDING_REVIEW: "info",
  VERIFIED: "success",
  CHANGES_REQUESTED: "warning",
  REJECTED: "destructive",
};

/**
 * Two orthogonal axes, per CLAUDE.md's "completion-vs-verification two-axis
 * model": `completionStatus` is organizer-facing ("have I filled this in?"),
 * `verificationState` is reviewer-facing ("has MUN Hub verified it?"). Both
 * badges already differ in color+label, but COMPLETE and VERIFIED previously
 * had no icon at all, so a quick glance at two green-ish badges couldn't tell
 * them apart. Giving each axis its own icon set (never sharing an icon
 * between "organizer says done" and "MUN Hub says verified") makes the two
 * badges — and the row's single leading icon below — distinguishable even
 * for someone skimming color alone. Mirrors the icon+color+label convention
 * `components/mun/mun-status-badge.tsx` already uses for `MunStatus`.
 */
const COMPLETION_ICON: Record<string, LucideIcon> = {
  NOT_STARTED: CircleIcon,
  IN_PROGRESS: PencilIcon,
  ACTION_REQUIRED: CircleAlertIcon,
  COMPLETE: CheckCircle2Icon,
  LOCKED: LockIcon,
};

/** Deliberately never CheckCircle2Icon — that belongs to `COMPLETE`, a different claim. */
const VERIFICATION_ICON: Record<string, LucideIcon> = {
  NOT_SUBMITTED: CircleIcon,
  PENDING_REVIEW: HourglassIcon,
  VERIFIED: ShieldCheckIcon,
  CHANGES_REQUESTED: TriangleAlertIcon,
  REJECTED: XCircleIcon,
};

function BadgeIcon({ icon: Icon }: { icon?: LucideIcon }) {
  return Icon ? <Icon className="size-3" aria-hidden /> : null;
}

/**
 * Every tracked module with its completion, MUN Hub's verification state, the
 * automated checks behind it, a link to where it's edited, and a per-module
 * "Send for review".
 */
export function GoLiveChecklist({ munId, modules }: { munId: string; modules: ModuleProgressSummary[] }) {
  const queryClient = useQueryClient();
  const sendMutation = useMutation({
    mutationFn: (moduleKey: string) => confirmModule(munId, moduleKey as MunModule),
    onSuccess: async (_row, moduleKey) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.munReviewFeedback(munId) }),
      ]);
      const label = modules.find((module) => module.key === moduleKey)?.label ?? "Section";
      toast.success(`${label} sent to MUN Hub for review`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to send for review"),
  });

  const ordered = [...modules].sort((a, b) => Number(b.isRequired) - Number(a.isRequired));

  return (
    <Card aria-labelledby="go-live-checklist-title">
      <CardHeader>
        <CardTitle>
          <h2 id="go-live-checklist-title" className="text-title-sm">Go-live checklist</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-xs">
        <p className="text-body-md text-muted-foreground">
          Each section needs to be complete before you submit. MUN Hub verifies every section before your MUN goes
          live.
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {ordered.map((module) => (
            <ChecklistRow
              key={module.key}
              munId={munId}
              module={module}
              sending={sendMutation.isPending && sendMutation.variables === module.key}
              onSend={() => sendMutation.mutate(module.key)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ChecklistRow({
  munId,
  module,
  sending,
  onSend,
}: {
  munId: string;
  module: ModuleProgressSummary;
  sending: boolean;
  onSend: () => void;
}) {
  const failing = module.checks.filter((check) => !check.passed);
  // Only BLOCKER checks stop a submission; the rest (e.g. payment
  // verification, which MUN Hub does) are shown as notes, not to-dos.
  const toFix = failing.filter((check) => check.severity === "BLOCKER");
  const [open, setOpen] = useState(false);
  const segment = MODULE_SECTION[module.key as MunModule];
  const section = segment ? getMunNavSection(segment) : undefined;
  const locked = module.completionStatus === "LOCKED";
  const checksId = `checks-${module.key}`;
  const total = module.checks.length;

  // The single leading icon for the row, in priority order. LOCKED and a
  // reviewer verdict both outrank plain "organizer says complete" — a module
  // MUN Hub sent back, or one currently frozen for review, must never render
  // the same reassuring checkmark as one that's simply filled in correctly.
  // See the two icon maps above for why VERIFIED never reuses COMPLETE's icon.
  let LeadingIcon: LucideIcon = CircleIcon;
  let leadingToneClass = "text-muted-foreground";
  if (locked) {
    LeadingIcon = LockIcon;
    leadingToneClass = "text-info-text";
  } else if (toFix.length > 0) {
    LeadingIcon = CircleAlertIcon;
    leadingToneClass = "text-warning-text";
  } else if (module.verificationState === "REJECTED") {
    LeadingIcon = XCircleIcon;
    leadingToneClass = "text-destructive-text";
  } else if (module.verificationState === "CHANGES_REQUESTED") {
    LeadingIcon = TriangleAlertIcon;
    leadingToneClass = "text-warning-text";
  } else if (module.verificationState === "VERIFIED") {
    LeadingIcon = ShieldCheckIcon;
    leadingToneClass = "text-success-text";
  } else if (module.completionStatus === "COMPLETE") {
    LeadingIcon = CheckCircle2Icon;
    leadingToneClass = "text-success-text";
  }

  return (
    <li className="flex flex-col gap-xs py-sm" data-testid={`module-${module.key}`}>
      <div className="flex flex-wrap items-center gap-xs">
        <LeadingIcon className={`size-4 shrink-0 ${leadingToneClass}`} aria-hidden />
        <span className="text-body-md font-medium text-ink">{module.label}</span>
        {!module.isRequired && <Badge variant="outline">Optional</Badge>}
        <span className="ml-auto flex flex-wrap items-center gap-xxs">
          <Badge variant={COMPLETION_VARIANT[module.completionStatus] ?? "secondary"}>
            <BadgeIcon icon={COMPLETION_ICON[module.completionStatus]} />
            {COMPLETION_STATUS_LABEL[module.completionStatus] ?? module.completionStatus}
          </Badge>
          <Badge variant={VERIFICATION_VARIANT[module.verificationState] ?? "secondary"}>
            <BadgeIcon icon={VERIFICATION_ICON[module.verificationState]} />
            {VERIFICATION_STATE_LABEL[module.verificationState] ?? module.verificationState}
          </Badge>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-sm pl-6">
        {locked && (
          <span className="flex items-center gap-xxs text-caption text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" aria-hidden />
            Locked while MUN Hub reviews your MUN — it reopens once the review finishes, or right away if a
            reviewer asks for changes to this section.
          </span>
        )}
        {toFix.length > 0 && (
          <span className="text-caption text-warning-text">
            {toFix.length === 1 ? "1 thing to fix" : `${toFix.length} things to fix`}
          </span>
        )}
        {total > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-xxs text-caption font-medium text-body hover:text-ink"
            aria-expanded={open}
            aria-controls={checksId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon className={"size-3.5 transition-transform " + (open ? "rotate-180" : "")} aria-hidden />
            {open ? "Hide checks" : total === 1 ? "Show the check" : `Show all ${total} checks`}
          </button>
        )}
        {section && segment !== "setup" && (
          <Link
            to={munSectionHref(munId, segment!)}
            className="text-caption font-medium text-link underline-offset-2 hover:underline"
          >
            Open {section.label}
          </Link>
        )}
        {canSendModuleForReview(module) && (
          <Button size="xs" variant="outline" disabled={sending} onClick={onSend} className="ml-auto">
            <SendIcon aria-hidden />
            {sending ? "Sending..." : `Send ${module.label} back for review`}
          </Button>
        )}
      </div>

      {(open || failing.length > 0) && (
        <ul id={checksId} className="flex flex-col gap-xxs pl-6">
          {(open ? module.checks : failing).map((check) => {
            const blocking = check.severity === "BLOCKER";
            return (
              <li key={check.key} className="flex items-start gap-xs text-caption">
                {check.passed ? (
                  <CheckCircle2Icon className="mt-px size-3.5 shrink-0 text-success-text" aria-hidden />
                ) : blocking ? (
                  <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-warning-text" aria-hidden />
                ) : (
                  <InfoIcon className="mt-px size-3.5 shrink-0 text-info-text" aria-hidden />
                )}
                <span className={check.passed ? "text-muted-foreground" : "text-body"}>
                  <span className="sr-only">
                    {check.passed ? "Passed: " : blocking ? "To fix: " : "Note: "}
                  </span>
                  {check.passed ? check.label : (check.message ?? check.label)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
