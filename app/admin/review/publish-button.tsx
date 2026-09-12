"use client";

import * as React from "react";
import { toast } from "sonner";
import { GlobeIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publishMunAction } from "./actions";

interface PublishButtonProps {
  munId: string;
  munName: string;
}

/**
 * VERIFICATION -> PUBLISHED. Separate from ReviewDecisionDialog because
 * `publishMun` takes no notes and is ADMIN/SUPER_ADMIN only (operations can
 * review but not publish) — the server enforces that, this button just
 * surfaces the resulting `Forbidden` as a toast rather than a crash.
 */
export function PublishButton({ munId, munName }: PublishButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await publishMunAction(munId);

      if (!result.ok) {
        toast.error(`Could not publish ${munName}`, { description: result.error });
        return;
      }

      setOpen(false);
      toast.success(`${munName} is live`, {
        description: "Published to the public marketplace.",
      });
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <GlobeIcon aria-hidden />
        Publish
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish to marketplace</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-ink">{munName}</span> becomes publicly visible and
              searchable immediately. Only admins can publish.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={handleConfirm}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <GlobeIcon aria-hidden />}
              {pending ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
