"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { BanIcon, Loader2Icon, UndoIcon, UploadIcon } from "lucide-react";
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
import { reinstateMunAction, suspendMunAction, unpublishMunAction } from "./actions";

const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

interface MunLifecycleButtonProps {
  munId: string;
  munName: string;
}

/**
 * PUBLISHED -> VERIFIED. Pure visibility toggle, no reason required — mirrors
 * `PublishButton`'s no-reason confirm-dialog shape (this action doesn't
 * change the content, only whether it's listed).
 */
export function UnpublishButton({ munId, munName }: MunLifecycleButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await unpublishMunAction(munId);

      if (!result.ok) {
        toast.error(`Could not unpublish ${munName}`, { description: result.error });
        return;
      }

      setOpen(false);
      toast.success(`${munName} unpublished`, {
        description: `Now ${getStatusMeta(result.status).label.toLowerCase()} — no longer visible on the marketplace.`,
      });
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UndoIcon aria-hidden />
        Unpublish
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish {munName}?</DialogTitle>
            <DialogDescription>
              Pulls this conference off the public marketplace immediately. Its verified content is
              kept — publish again later with no re-verification needed.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={handleConfirm}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <UndoIcon aria-hidden />}
              {pending ? "Unpublishing…" : "Confirm unpublish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * PUBLISHED/REGISTRATION_OPEN/etc -> SUSPENDED. Requires a non-empty reason —
 * same reactive-state pattern as `app/admin/organizers/suspend-dialog.tsx`'s
 * `SuspendDialog` (controlled textarea driving a disabled-until-non-empty
 * confirm button), not an uncontrolled `FormData` read, per that component's
 * own review history.
 */
export function SuspendMunButton({ munId, munName }: MunLifecycleButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      // Belt-and-suspenders — the submit button is already disabled in this
      // case, so this should be unreachable, but never trust the client
      // boundary alone.
      toast.error("A reason is required to suspend a MUN.");
      return;
    }

    startTransition(async () => {
      const result = await suspendMunAction(munId, trimmedReason);

      if (!result.ok) {
        toast.error(`Could not suspend ${munName}`, { description: result.error });
        return;
      }

      setOpen(false);
      setReason("");
      toast.success(`${munName} suspended`, {
        description: "Hidden from the marketplace and blocked from new registrations.",
      });
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dialog can also be dismissed via backdrop/Escape, not just Cancel —
      // clear the reason either way so a stale draft never reappears on this
      // mun's next suspend attempt.
      setReason("");
    }
  }

  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        <BanIcon aria-hidden />
        Suspend
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Suspend {munName}?</DialogTitle>
            <DialogDescription>
              Hides this conference from the marketplace and blocks new registrations immediately.
              Reversible — reinstating sends it back through verification before it can go live again.
            </DialogDescription>
          </DialogHeader>

          <form action={handleConfirm} className="flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <Label htmlFor={`suspend-reason-${munId}`}>Reason</Label>
              <textarea
                id={`suspend-reason-${munId}`}
                name="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                className={fieldClassName}
                placeholder="Recorded in the admin action log. Required."
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
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={pending || !reason.trim()}
              >
                {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <BanIcon aria-hidden />}
                {pending ? "Suspending…" : "Confirm suspension"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * SUSPENDED -> VERIFICATION. No reason required (the suspension reason is
 * already on record from `suspendMun`); reinstating just re-opens the
 * verification gate.
 */
export function ReinstateMunButton({ munId, munName }: MunLifecycleButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await reinstateMunAction(munId);

      if (!result.ok) {
        toast.error(`Could not reinstate ${munName}`, { description: result.error });
        return;
      }

      setOpen(false);
      toast.success(`${munName} sent back for verification`, {
        description: "It must pass verification again before it can be published.",
      });
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UploadIcon aria-hidden />
        Reinstate
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reinstate {munName}?</DialogTitle>
            <DialogDescription>
              Moves this conference out of SUSPENDED and back into verification. It won&apos;t be
              publishable again until it passes review.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={handleConfirm}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <UploadIcon aria-hidden />}
              {pending ? "Reinstating…" : "Confirm reinstate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
