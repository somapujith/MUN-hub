import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ChevronDownIcon, CircleAlertIcon, CircleIcon, SendIcon } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const segment = MODULE_SECTION[module.key as MunModule];
  const section = segment ? getMunNavSection(segment) : undefined;
  const complete = module.completionStatus === "COMPLETE" || (module.completionStatus === "LOCKED" && failing.length === 0);
  const checksId = `checks-${module.key}`;

  return (
    <li className="flex flex-col gap-xs py-sm" data-testid={`module-${module.key}`}>
      <div className="flex flex-wrap items-center gap-xs">
        {complete ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-success-text" aria-hidden />
        ) : failing.length > 0 ? (
          <CircleAlertIcon className="size-4 shrink-0 text-warning-text" aria-hidden />
        ) : (
          <CircleIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="text-body-md font-medium text-ink">{module.label}</span>
        {!module.isRequired && <Badge variant="outline">Optional</Badge>}
        <span className="ml-auto flex flex-wrap items-center gap-xxs">
          <Badge variant={COMPLETION_VARIANT[module.completionStatus] ?? "secondary"}>
            {COMPLETION_STATUS_LABEL[module.completionStatus] ?? module.completionStatus}
          </Badge>
          <Badge variant={VERIFICATION_VARIANT[module.verificationState] ?? "secondary"}>
            {VERIFICATION_STATE_LABEL[module.verificationState] ?? module.verificationState}
          </Badge>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-sm pl-6">
        {failing.length > 0 && (
          <span className="text-caption text-warning-text">
            {failing.length} of {module.checks.length} checks need attention
          </span>
        )}
        {module.checks.length > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-xxs text-caption font-medium text-body hover:text-ink"
            aria-expanded={open}
            aria-controls={checksId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon className={"size-3.5 transition-transform " + (open ? "rotate-180" : "")} aria-hidden />
            {open ? "Hide passed checks" : `Show all ${module.checks.length} checks`}
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
            {sending
              ? "Sending..."
              : module.verificationState === "CHANGES_REQUESTED"
                ? `Send ${module.label} back for review`
                : `Send ${module.label} for review`}
          </Button>
        )}
      </div>

      {(open || failing.length > 0) && (
        <ul id={checksId} className="flex flex-col gap-xxs pl-6">
          {(open ? module.checks : failing).map((check) => (
            <li key={check.key} className="flex items-start gap-xs text-caption">
              {check.passed ? (
                <CheckCircle2Icon className="mt-px size-3.5 shrink-0 text-success-text" aria-hidden />
              ) : (
                <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-warning-text" aria-hidden />
              )}
              <span className={check.passed ? "text-muted-foreground" : "text-body"}>
                <span className="sr-only">{check.passed ? "Passed: " : "Needs attention: "}</span>
                {check.passed ? check.label : (check.message ?? check.label)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
