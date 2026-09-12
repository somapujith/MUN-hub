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
import { getStatusMeta } from "@/lib/mun-status";
import { submitReviewDecision, type ReviewDecision } from "./actions";

const DECISION_COPY: Record<
  ReviewDecision,
  {
    verb: string;
    title: string;
    description: string;
    notesLabel: string;
    notesHint: string;
    confirmVariant: "default" | "destructive" | "outline";
    Icon: typeof CheckIcon;
  }
> = {
  APPROVED: {
    verb: "Approve",
    title: "Approve application",
    description:
      "Moves the MUN to APPROVED and starts organizer onboarding. The decision is written to the verification log.",
    notesLabel: "Note to organizer",
    notesHint: "Shared with the organizer. Optional.",
    confirmVariant: "default",
    Icon: CheckIcon,
  },
  CHANGES_REQUESTED: {
    verb: "Request changes",
    title: "Request changes",
    description:
      "Sends the application back to the organizer. They can revise and resubmit, which returns it to this queue.",
    notesLabel: "What needs to change",
    notesHint: "Shared with the organizer. Be specific — this is what they act on.",
    confirmVariant: "outline",
    Icon: TriangleAlertIcon,
  },
  REJECTED: {
    verb: "Reject",
    title: "Reject application",
    description:
      "REJECTED is terminal — the lifecycle allows no transition out of it. The organizer would have to apply again from scratch.",
    notesLabel: "Reason for rejection",
    notesHint: "Shared with the organizer. Optional but strongly recommended.",
    confirmVariant: "destructive",
    Icon: XCircleIcon,
  },
};

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

interface ReviewDecisionDialogProps {
  munId: string;
  munName: string;
  decision: ReviewDecision;
  triggerClassName?: string;
}

export function ReviewDecisionDialog({
  munId,
  munName,
  decision,
  triggerClassName,
}: ReviewDecisionDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const copy = DECISION_COPY[decision];
  const { Icon } = copy;

  function handleConfirm(formData: FormData) {
    const notes = String(formData.get("notes") ?? "");
    const internalNotes = String(formData.get("internalNotes") ?? "");

    startTransition(async () => {
      const result = await submitReviewDecision(munId, decision, notes, internalNotes);

      if (!result.ok) {
        toast.error(`Could not ${copy.verb.toLowerCase()} ${munName}`, {
          description: result.error,
        });
        return;
      }

      setOpen(false);
      toast.success(`${munName} → ${getStatusMeta(result.status).label}`, {
        description: "Decision recorded in the verification log.",
      });
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={decision === "APPROVED" ? "default" : decision === "REJECTED" ? "destructive" : "outline"}
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
              <span className="font-medium text-ink">{munName}</span> — {copy.description}
            </DialogDescription>
          </DialogHeader>

          <form action={handleConfirm} className="flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <Label htmlFor={`notes-${munId}-${decision}`}>{copy.notesLabel}</Label>
              <textarea
                id={`notes-${munId}-${decision}`}
                name="notes"
                rows={3}
                disabled={pending}
                className={fieldClassName}
                placeholder={copy.notesHint}
              />
              <p className="text-[12px] leading-[1.35] text-muted-foreground">{copy.notesHint}</p>
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor={`internal-${munId}-${decision}`}>Internal note</Label>
              <textarea
                id={`internal-${munId}-${decision}`}
                name="internalNotes"
                rows={2}
                disabled={pending}
                className={fieldClassName}
                placeholder="Ops-only. Never shown to the organizer."
              />
              <p className="text-[12px] leading-[1.35] text-muted-foreground">
                Visible to operations and admin only.
              </p>
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
