import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getAdminResultsReview, reviewResults } from "@/api/results";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatAdminDateTime } from "@/lib/admin/go-live-labels";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import { adminTextareaClassName } from "@/lib/admin/styles";
import type { MunStatus } from "@/types/enums";
import type { ResultsReviewDecision } from "@/types/results";

const DECISIONS: Array<{ value: ResultsReviewDecision; label: string; hint: string }> = [
  {
    value: "APPROVE",
    label: "Approve results",
    hint: "The conference is marked completed and its awards are verified.",
  },
  {
    value: "RETURN",
    label: "Request changes",
    hint: "The results go back to the organizer with your note, and the awards can be edited again.",
  },
];

const SUCCESS_MESSAGE: Record<ResultsReviewDecision, string> = {
  APPROVE: "Results approved — the conference is completed",
  RETURN: "Results returned to the organizer",
};

interface ResultsReviewSectionProps {
  munId: string;
  munName: string;
  status: MunStatus;
  /** Refreshes the conference page (and overview counts) after a decision. */
  onDecided: () => Promise<unknown>;
}

/**
 * Staff review of a MUN's conference results (awards), shown on the admin
 * conference page while the results are with the organizer
 * (RESULTS_PENDING) or waiting for MUNHub (RESULTS_UNDER_REVIEW). Every
 * staff role can decide; the server re-checks the role and the status.
 */
export function ResultsReviewSection({ munId, munName, status, onDecided }: ResultsReviewSectionProps) {
  const headingId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const awaitingDecision = status === "RESULTS_UNDER_REVIEW";

  const reviewQuery = useQuery({
    queryKey: adminQueryKeys.munResults(munId),
    queryFn: () => getAdminResultsReview(munId),
  });
  const review = reviewQuery.data;
  const awards = review?.awards ?? [];

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-md rounded-md border border-border bg-card p-lg"
    >
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex flex-col gap-xxs">
          <h2 id={headingId} className="font-display text-title-sm text-ink">
            Results review
          </h2>
          <p className="text-body-md text-muted-foreground">
            {awaitingDecision
              ? "The organizer has submitted the conference results. Check the awards, then approve them or request changes."
              : "The results are with the organizer. They can be reviewed once the organizer submits them."}
          </p>
        </div>
        {awaitingDecision && (
          <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!review}>
            Review results
          </Button>
        )}
      </div>

      {reviewQuery.isLoading && <Skeleton className="h-24 w-full" />}
      {reviewQuery.isError && (
        <p className="text-body-md text-destructive">
          {reviewQuery.error instanceof Error ? reviewQuery.error.message : "Unable to load the results."}
        </p>
      )}

      {review && (
        <>
          <dl className="grid grid-cols-1 gap-md sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">Awards</dt>
              <dd className="text-body-md text-ink tabular-nums">{review.state.awardCount}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                Last submitted
              </dt>
              <dd className="text-body-md text-ink">{formatAdminDateTime(review.state.submittedAt)}</dd>
            </div>
            {review.state.returnNote && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                  Changes requested
                </dt>
                <dd className="text-body-md text-ink">{review.state.returnNote}</dd>
              </div>
            )}
          </dl>

          {awards.length === 0 ? (
            <p className="text-body-md text-muted-foreground">No awards have been entered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-body-md">
                <caption className="sr-only">Awards entered for {munName}</caption>
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-sm pr-md font-medium">Award</th>
                    <th scope="col" className="py-sm pr-md font-medium">Delegate</th>
                    <th scope="col" className="py-sm pr-md font-medium">Committee</th>
                    <th scope="col" className="py-sm font-medium">Portfolio</th>
                  </tr>
                </thead>
                <tbody>
                  {awards.map((award) => (
                    <tr key={award.id} className="border-b border-border last:border-0">
                      <td className="py-sm pr-md font-medium text-ink">{award.award ?? "—"}</td>
                      <td className="py-sm pr-md">
                        <span className="block text-ink">{award.delegateName}</span>
                        <span className="block break-all text-muted-foreground">{award.delegateEmail}</span>
                      </td>
                      <td className="py-sm pr-md text-body">{award.committee ?? "—"}</td>
                      <td className="py-sm text-body">{award.portfolio ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ResultsDecisionDialog
        open={dialogOpen}
        munId={munId}
        munName={munName}
        onClose={() => setDialogOpen(false)}
        onDecided={onDecided}
      />
    </section>
  );
}

interface ResultsDecisionDialogProps {
  open: boolean;
  munId: string;
  munName: string;
  onClose: () => void;
  onDecided: () => Promise<unknown>;
}

function ResultsDecisionDialog({ open, munId, munName, onClose, onDecided }: ResultsDecisionDialogProps) {
  const noteId = useId();
  const [decision, setDecision] = useState<ResultsReviewDecision>("APPROVE");
  const [note, setNote] = useState("");
  const [showNoteError, setShowNoteError] = useState(false);

  const noteRequired = decision === "RETURN";
  const noteMissing = noteRequired && note.trim().length === 0;

  const close = () => {
    setDecision("APPROVE");
    setNote("");
    setShowNoteError(false);
    onClose();
  };

  const mutation = useMutation({
    mutationFn: () => reviewResults(munId, decision, note.trim() || undefined),
    onSuccess: async () => {
      toast.success(SUCCESS_MESSAGE[decision]);
      await onDecided();
      close();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to record the decision"),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (noteMissing) {
      setShowNoteError(true);
      document.getElementById(noteId)?.focus();
      return;
    }
    mutation.mutate();
  };

  const selected = DECISIONS.find((option) => option.value === decision)!;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-lg">
          <DialogHeader>
            <DialogTitle>Review results for {munName}</DialogTitle>
            <DialogDescription>Your decision and note are recorded in the conference history.</DialogDescription>
          </DialogHeader>

          <fieldset className="flex flex-col gap-xs">
            <legend className="mb-xs text-body-md font-medium text-ink">Decision</legend>
            <div className="grid grid-cols-1 gap-xs sm:grid-cols-2">
              {DECISIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-xs rounded-sm border border-border bg-background px-sm py-xs text-body-md text-ink has-checked:border-ring has-checked:bg-surface-soft"
                >
                  <input
                    type="radio"
                    name="results-decision"
                    value={option.value}
                    checked={decision === option.value}
                    onChange={() => {
                      setDecision(option.value);
                      setShowNoteError(false);
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
            <Label htmlFor={noteId}>{noteRequired ? "What should the organizer change?" : "Note (optional)"}</Label>
            <textarea
              id={noteId}
              className={adminTextareaClassName}
              value={note}
              maxLength={2000}
              onChange={(event) => {
                setNote(event.target.value);
                if (event.target.value.trim()) setShowNoteError(false);
              }}
              aria-invalid={showNoteError && noteMissing ? true : undefined}
              aria-describedby={showNoteError && noteMissing ? `${noteId}-error` : undefined}
              placeholder={noteRequired ? "Required: the organizer sees this note" : "Recorded with the approval"}
            />
            {showNoteError && noteMissing && (
              <p id={`${noteId}-error`} role="alert" className="text-body-md text-destructive">
                Tell the organizer what needs to change.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : selected.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
