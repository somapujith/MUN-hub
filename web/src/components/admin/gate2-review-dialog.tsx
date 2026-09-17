import { useId, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { reviewSubmission } from "@/api/go-live";
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
import { adminTextareaClassName } from "@/lib/admin/styles";
import type { SubmissionReviewDecision } from "@/types/admin-muns";

const DECISIONS: Array<{ value: SubmissionReviewDecision; label: string; hint: string }> = [
  { value: "APPROVED", label: "Approve", hint: "Content is verified. An admin can then queue and publish it." },
  {
    value: "CHANGES_REQUESTED",
    label: "Request changes",
    hint: "The organizer gets your note and the MUN returns to Action required.",
  },
  { value: "REJECTED", label: "Reject", hint: "Final. The submission and the MUN are rejected." },
];

const SUCCESS_MESSAGE: Record<SubmissionReviewDecision, string> = {
  APPROVED: "Submission approved",
  CHANGES_REQUESTED: "Changes requested from the organizer",
  REJECTED: "Submission rejected",
};

interface Gate2ReviewDialogProps {
  /** The MUN under review, or null when the dialog is closed. */
  target: { munId: string; munName: string } | null;
  onClose: () => void;
  onDecided: () => Promise<unknown> | void;
}

/**
 * Gate 2 content-review decision on a MUN's active submission
 * (`reviewSubmission`). Legal while the MUN is in VERIFICATION. Requesting
 * changes or rejecting needs a reason, which the organizer sees. This never
 * decides a Gate 1 organizer application (see AdminReviewPage).
 */
export function Gate2ReviewDialog({ target, onClose, onDecided }: Gate2ReviewDialogProps) {
  const notesId = useId();
  const [decision, setDecision] = useState<SubmissionReviewDecision>("APPROVED");
  const [notes, setNotes] = useState("");
  const [showReasonError, setShowReasonError] = useState(false);

  const reasonRequired = decision !== "APPROVED";
  const reasonMissing = reasonRequired && notes.trim().length === 0;

  const close = () => {
    setDecision("APPROVED");
    setNotes("");
    setShowReasonError(false);
    onClose();
  };

  const mutation = useMutation({
    mutationFn: () => {
      const text = notes.trim() || undefined;
      return reviewSubmission(target!.munId, {
        decision,
        notes: text,
        // The server stores `reason` as the rejection reason.
        reason: decision === "REJECTED" ? text : undefined,
      });
    },
    onSuccess: async () => {
      toast.success(SUCCESS_MESSAGE[decision]);
      await onDecided();
      close();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record the decision"),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (reasonMissing) {
      setShowReasonError(true);
      document.getElementById(notesId)?.focus();
      return;
    }
    mutation.mutate();
  };

  const selected = DECISIONS.find((option) => option.value === decision)!;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-lg">
          <DialogHeader>
            <DialogTitle>Review {target?.munName}</DialogTitle>
            <DialogDescription>
              Gate 2 content review of the submitted MUN. This does not touch the organizer&apos;s application.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="flex flex-col gap-xs">
            <legend className="mb-xs text-body-md font-medium text-ink">Decision</legend>
            <div className="grid grid-cols-1 gap-xs sm:grid-cols-3">
              {DECISIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-xs rounded-sm border border-border bg-background px-sm py-xs text-body-md text-ink has-checked:border-ring has-checked:bg-surface-soft"
                >
                  <input
                    type="radio"
                    name="gate2-decision"
                    value={option.value}
                    checked={decision === option.value}
                    onChange={() => {
                      setDecision(option.value);
                      setShowReasonError(false);
                    }}
                    className="accent-primary"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className="text-body-md text-muted-foreground">{selected.hint}</p>
          </fieldset>

          <div className="flex flex-col gap-xs">
            <Label htmlFor={notesId}>{reasonRequired ? "Reason for the organizer" : "Notes for the organizer"}</Label>
            <textarea
              id={notesId}
              className={adminTextareaClassName}
              value={notes}
              maxLength={2000}
              onChange={(event) => {
                setNotes(event.target.value);
                if (event.target.value.trim()) setShowReasonError(false);
              }}
              aria-invalid={showReasonError && reasonMissing ? true : undefined}
              aria-describedby={showReasonError && reasonMissing ? `${notesId}-error` : undefined}
              placeholder={
                reasonRequired ? "Required: what needs to change, or why this is rejected" : "Optional"
              }
            />
            {showReasonError && reasonMissing && (
              <p id={`${notesId}-error`} role="alert" className="text-body-md text-destructive">
                {decision === "REJECTED"
                  ? "Give the organizer a reason for the rejection."
                  : "Tell the organizer what needs to change."}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={decision === "REJECTED" ? "destructive" : "default"}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : selected.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
