"use client";

import * as React from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "./actions";

/**
 * Destructive confirm, matching `app/admin/review/review-decision-dialog.tsx`:
 * `variant="destructive"` on the confirm button (never a className color
 * override — the Button variants mark their text color `!important` to survive
 * tailwind-merge, so a call-site color loses that fight silently), and the
 * consequence spelled out in the description rather than a generic "are you
 * sure?".
 *
 * `deleteCommittee` / `deletePortfolio` are HARD deletes (see the comments on
 * both in `lib/actions/mun-config.ts`) and the `portfolios.committee_id` FK is
 * `ON DELETE CASCADE`, so deleting a committee takes its portfolios with it.
 * The caller passes that count in so the dialog can say so out loud.
 */

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What is about to be destroyed, named. Rendered in ink. */
  subject: string;
  /** The consequence, in one sentence. */
  consequence: string;
  confirmLabel: string;
  onConfirm: () => Promise<ActionResult>;
  onDeleted?: () => void;
}

export function DeleteDialog({
  open,
  onOpenChange,
  title,
  subject,
  consequence,
  confirmLabel,
  onConfirm,
  onDeleted,
}: DeleteDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await onConfirm();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onDeleted?.();
      toast.success(`${subject} deleted`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{subject}</span> —{" "}
            {consequence}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className={cn(
              "rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-xs",
              "text-body-md text-destructive-text",
            )}
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <Trash2Icon aria-hidden />
            )}
            {pending ? "Deleting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
