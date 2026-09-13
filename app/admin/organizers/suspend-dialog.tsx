"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { BanIcon, Loader2Icon, UndoIcon } from "lucide-react";
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
import type { OrganizerRow } from "@/lib/actions/organizer-admin";
import { reinstateOrganizerAction, suspendOrganizerAction } from "./actions";

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

/**
 * Suspend/reinstate confirmation dialog for one organizer row. Mirrors the
 * decision-dialog pattern in `app/admin/review/review-decision-dialog.tsx`
 * and `app/admin/verification/module-review-dialog.tsx`: a trigger button
 * that opens a `Dialog`, a `form action` that calls the route-local action
 * wrapper, and a toast on the result.
 */
export function SuspendDialog({ organizer }: { organizer: OrganizerRow }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const isSuspending = !organizer.suspended;

  function handleConfirm() {
    const trimmedReason = reason.trim();

    if (isSuspending && !trimmedReason) {
      // Belt-and-suspenders — the submit button is already disabled in this
      // case, so this should be unreachable, but never trust the client
      // boundary alone.
      toast.error("A reason is required to suspend an organizer.");
      return;
    }

    startTransition(async () => {
      const result = isSuspending
        ? await suspendOrganizerAction(organizer.id, trimmedReason)
        : await reinstateOrganizerAction(organizer.id);

      if (!result.ok) {
        toast.error(`Could not ${isSuspending ? "suspend" : "reinstate"} ${organizer.name}`, {
          description: result.error,
        });
        return;
      }

      setOpen(false);
      setReason("");
      toast.success(`${organizer.name} ${isSuspending ? "suspended" : "reinstated"}`, {
        description: isSuspending
          ? "Their login is now blocked. Existing MUNs are unaffected."
          : "Their login access has been restored.",
      });
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dialog can also be dismissed via backdrop/Escape, not just Cancel —
      // clear the reason either way so a stale draft never reappears on
      // this organizer's next suspend attempt.
      setReason("");
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant={isSuspending ? "destructive" : "outline"}
        onClick={() => setOpen(true)}
      >
        {isSuspending ? <BanIcon aria-hidden /> : <UndoIcon aria-hidden />}
        {isSuspending ? "Suspend" : "Reinstate"}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isSuspending ? `Suspend ${organizer.name}?` : `Reinstate ${organizer.name}?`}
            </DialogTitle>
            <DialogDescription>
              {isSuspending
                ? "This blocks their login immediately. Existing MUNs are not affected — unpublish or suspend a specific MUN separately if its content is the problem."
                : "This restores their login access. The suspension record stays in the admin action log."}
            </DialogDescription>
          </DialogHeader>

          <form action={handleConfirm} className="flex flex-col gap-md">
            {isSuspending && (
              <div className="flex flex-col gap-xs">
                <Label htmlFor={`reason-${organizer.id}`}>Reason</Label>
                <textarea
                  id={`reason-${organizer.id}`}
                  name="reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending}
                  className={fieldClassName}
                  placeholder="Recorded in the admin action log. Required."
                />
              </div>
            )}

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
              <Button
                type="submit"
                size="sm"
                variant={isSuspending ? "destructive" : "default"}
                disabled={pending || (isSuspending && !reason.trim())}
              >
                {pending ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : isSuspending ? (
                  <BanIcon aria-hidden />
                ) : (
                  <UndoIcon aria-hidden />
                )}
                {pending ? "Saving…" : isSuspending ? "Confirm suspension" : "Confirm reinstate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
