"use client";

import * as React from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "./actions";
import type { ExecutiveBoardRow } from "./queries";

export function DeleteExecutiveBoardDialog({ member, open, onOpenChange, onConfirm }: { member: ExecutiveBoardRow; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<ActionResult> }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await onConfirm();
      if (!result.ok) { setError(result.error); return; }
      onOpenChange(false);
    });
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Remove board member?</DialogTitle><DialogDescription><span className="font-medium text-ink">{member.name}</span> will be removed from this conference&apos;s executive board.</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-xs text-body-md text-destructive-text">{error}</p>}<DialogFooter><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" variant="destructive" size="sm" disabled={pending} onClick={confirm}>{pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <Trash2Icon aria-hidden />}{pending ? "Removing…" : "Remove member"}</Button></DialogFooter></DialogContent></Dialog>;
}