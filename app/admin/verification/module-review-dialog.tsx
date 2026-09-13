"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckIcon, TriangleAlertIcon, XCircleIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { MunModule, VerificationSeverity } from "@/lib/db/schema-enums";
import { submitModuleReview, type ModuleReviewDecision } from "./actions";

const DECISION_COPY: Record<
  ModuleReviewDecision,
  {
    verb: string;
    title: string;
    description: string;
    requireReason: boolean;
    confirmVariant: "default" | "destructive" | "outline";
    Icon: typeof CheckIcon;
  }
> = {
  VERIFIED: {
    verb: "Verify",
    title: "Verify module",
    description:
      "Marks this module VERIFIED. Once all four tracked modules are verified, the conference automatically advances to VERIFIED status.",
    requireReason: false,
    confirmVariant: "default",
    Icon: CheckIcon,
  },
  CHANGES_REQUESTED: {
    verb: "Request changes",
    title: "Request changes",
    description:
      "Sends this module back to the organizer. They can revise and re-confirm it, which returns it to this queue.",
    requireReason: true,
    confirmVariant: "outline",
    Icon: TriangleAlertIcon,
  },
  REJECTED: {
    verb: "Reject",
    title: "Reject module",
    description: "Marks this module REJECTED. The organizer will need to revise it before it can be re-confirmed.",
    requireReason: true,
    confirmVariant: "destructive",
    Icon: XCircleIcon,
  },
};

const SEVERITY_OPTIONS: VerificationSeverity[] = ["BLOCKER", "HIGH", "MEDIUM", "LOW"];

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

const selectClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md text-body-md text-ink transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "dark:bg-card",
);

interface ModuleReviewDialogProps {
  munId: string;
  munName: string;
  moduleName: MunModule;
  moduleLabel: string;
  decision: ModuleReviewDecision;
  triggerClassName?: string;
}

export function ModuleReviewDialog({
  munId,
  munName,
  moduleName,
  moduleLabel,
  decision,
  triggerClassName,
}: ModuleReviewDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const copy = DECISION_COPY[decision];
  const { Icon } = copy;

  function handleConfirm(formData: FormData) {
    if (copy.requireReason && !String(formData.get("reason") ?? "").trim()) {
      toast.error("A reason is required for this decision.");
      return;
    }

    startTransition(async () => {
      const result = await submitModuleReview(munId, moduleName, decision, formData);

      if (!result.ok) {
        toast.error(`Could not ${copy.verb.toLowerCase()} ${moduleLabel}`, {
          description: result.error,
        });
        return;
      }

      setOpen(false);
      toast.success(`${munName} — ${moduleLabel} ${copy.verb.toLowerCase()}d`, {
        description: "Decision recorded.",
      });
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={decision === "VERIFIED" ? "default" : decision === "REJECTED" ? "destructive" : "outline"}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <Icon aria-hidden />
        {copy.verb}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-ink">{munName}</span> — {moduleLabel}. {copy.description}
            </DialogDescription>
          </DialogHeader>

          <form action={handleConfirm} className="flex flex-col gap-md">
            {copy.requireReason && (
              <div className="flex flex-col gap-xs">
                <Label htmlFor={`severity-${munId}-${moduleName}`}>Severity</Label>
                <select
                  id={`severity-${munId}-${moduleName}`}
                  name="severity"
                  defaultValue="MEDIUM"
                  disabled={pending}
                  className={selectClassName}
                >
                  {SEVERITY_OPTIONS.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-xs">
              <Label htmlFor={`reason-${munId}-${moduleName}`}>
                Reason {copy.requireReason ? "" : "(optional)"}
              </Label>
              <textarea
                id={`reason-${munId}-${moduleName}`}
                name="reason"
                rows={3}
                disabled={pending}
                className={fieldClassName}
                placeholder="Be specific — this is what the organizer acts on."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" variant={copy.confirmVariant} disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
                {pending ? "Saving…" : copy.verb}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
