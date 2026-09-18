import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { reviewModule } from "@/api/module-verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MODULE_LABELS, SEVERITY_OPTIONS } from "@/lib/admin/module-labels";
import type { ModuleReviewDecision, VerificationIssueInput } from "@/types/module-verification";
import type { MunModule } from "@/types/enums";

const DECISION_OPTIONS: Array<{ value: ModuleReviewDecision; label: string }> = [
  { value: "VERIFIED", label: "Verify" },
  { value: "CHANGES_REQUESTED", label: "Request changes" },
  { value: "REJECTED", label: "Reject" },
];

const EMPTY_ISSUE: VerificationIssueInput = { severity: "MEDIUM", reason: "" };

interface ModuleReviewFormProps {
  munId: string;
  moduleName: MunModule;
  munName: string;
  /**
   * Called after a successful decision. The caller decides what to
   * refetch/invalidate (and whether to close a dialog) — this component only
   * resets its own local decision/issues state.
   */
  onDecided: () => void;
  /** Renders a Cancel button when provided (e.g. to close a dialog). Omit for an always-visible inline form. */
  onCancel?: () => void;
}

/**
 * Gate 2 — module-level content-review decision form. Extracted from
 * AdminVerificationPage's dialog so it can also be embedded inline in a
 * per-MUN module row (conference-detail-page.tsx's ModulesSection). Deliberately
 * chrome-agnostic — no Dialog-specific markup — so either caller can wrap it
 * however it likes; the action row at the bottom is a plain bordered strip
 * that reads fine both inline and inside a dialog.
 */
export function ModuleReviewForm({ munId, moduleName, munName, onDecided, onCancel }: ModuleReviewFormProps) {
  const [decision, setDecision] = useState<ModuleReviewDecision>("VERIFIED");
  const [issues, setIssues] = useState<VerificationIssueInput[]>([]);

  const decideMutation = useMutation({
    mutationFn: () =>
      reviewModule(munId, moduleName, {
        decision,
        issues: issues
          .filter((issue) => issue.reason.trim().length > 0)
          .map((issue) => ({
            ...issue,
            reason: issue.reason.trim(),
            previousValue: issue.previousValue?.trim() || undefined,
            newValue: issue.newValue?.trim() || undefined,
          })),
      }),
    onSuccess: () => {
      toast.success(
        decision === "VERIFIED"
          ? "Module verified"
          : decision === "REJECTED"
            ? "Module rejected"
            : "Changes requested from organizer",
      );
      setDecision("VERIFIED");
      setIssues([]);
      onDecided();
    },
    // reviewModule row-locks and rejects a module that moved on since this
    // form was opened (e.g. another admin reviewed it first) with a message
    // ending "reload and try again" — surfaced verbatim, it's already
    // specific enough that no extra wrapping text is needed here.
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record decision"),
  });

  const requiresIssues = decision !== "VERIFIED";
  const validIssueCount = issues.filter((issue) => issue.reason.trim().length > 0).length;
  const canSubmit = !requiresIssues || validIssueCount > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      toast.error("At least one issue with a reason is required for this decision");
      return;
    }
    decideMutation.mutate();
  };

  const addIssue = () => setIssues((prev) => [...prev, { ...EMPTY_ISSUE }]);
  const removeIssue = (index: number) => setIssues((prev) => prev.filter((_, i) => i !== index));
  const updateIssue = (index: number, patch: Partial<VerificationIssueInput>) =>
    setIssues((prev) => prev.map((issue, i) => (i === index ? { ...issue, ...patch } : issue)));

  const decisionFieldId = `module-decision-${munId}-${moduleName}`;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={`Gate 2 review — ${MODULE_LABELS[moduleName] ?? moduleName} for ${munName}`}
      className="flex flex-col gap-lg"
    >
      <div className="flex flex-col gap-xs">
        <Label htmlFor={decisionFieldId}>Decision</Label>
        <select
          id={decisionFieldId}
          className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
          value={decision}
          onChange={(event) => setDecision(event.target.value as ModuleReviewDecision)}
        >
          {DECISION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-sm">
        <div className="flex items-center justify-between">
          <Label>
            Issues {requiresIssues && <span className="text-destructive">(at least one required)</span>}
          </Label>
          <Button type="button" variant="outline" size="sm" onClick={addIssue}>
            <PlusIcon aria-hidden /> Add issue
          </Button>
        </div>

        {issues.length === 0 && <p className="text-body-md text-muted-foreground">No issues added.</p>}

        {issues.map((issue, index) => (
          <div key={index} className="flex flex-col gap-xs rounded-md border border-border p-md">
            <div className="flex items-center gap-xs">
              <select
                aria-label={`Severity for issue ${index + 1}`}
                className="h-9 rounded-sm border border-input bg-background px-sm text-body-md text-ink"
                value={issue.severity}
                onChange={(event) =>
                  updateIssue(index, { severity: event.target.value as VerificationIssueInput["severity"] })
                }
              >
                {SEVERITY_OPTIONS.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove issue ${index + 1}`}
                onClick={() => removeIssue(index)}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </div>
            <Input
              aria-label={`Reason for issue ${index + 1}`}
              placeholder="What's wrong with this module's content?"
              value={issue.reason}
              onChange={(event) => updateIssue(index, { reason: event.target.value })}
            />
            <div className="grid grid-cols-2 gap-xs">
              <Input
                aria-label={`Previous value for issue ${index + 1}`}
                placeholder="Previous value (optional)"
                value={issue.previousValue ?? ""}
                onChange={(event) => updateIssue(index, { previousValue: event.target.value })}
              />
              <Input
                aria-label={`Expected value for issue ${index + 1}`}
                placeholder="Expected value (optional)"
                value={issue.newValue ?? ""}
                onChange={(event) => updateIssue(index, { newValue: event.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col-reverse gap-sm border-t border-border pt-md sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          variant={decision === "REJECTED" ? "destructive" : "default"}
          disabled={decideMutation.isPending || !canSubmit}
        >
          {decideMutation.isPending
            ? "Submitting..."
            : (DECISION_OPTIONS.find((o) => o.value === decision)?.label ?? "Submit")}
        </Button>
      </div>
    </form>
  );
}
