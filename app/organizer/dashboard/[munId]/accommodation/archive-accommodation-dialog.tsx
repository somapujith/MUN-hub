"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArchiveIcon,
  Loader2Icon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { archiveOptionAction, deleteFieldAction } from "./actions";
import type { AccommodationOptionRow, FieldRow } from "./queries";

/**
 * The two destructive confirms for this module. They live in one file because
 * they share a footer, a pending pattern and a tone — but they are NOT one
 * component, because the underlying operations differ in a way the copy has to
 * reflect honestly:
 *
 *   Option -> ARCHIVE (soft). `deleteAccommodationOption` sets
 *             `status = 'inactive'` and leaves the row, because
 *             `registrations.accommodationOptionId` references it and carries
 *             payment history. Reversible, and the copy says so.
 *
 *   Field  -> DELETE (hard). `deleteAccommodationOptionField` removes the row;
 *             the lib layer's own comment justifies this on the grounds that no
 *             financial record depends on a field DEFINITION existing. NOT
 *             reversible, and the copy says that instead.
 *
 * Labelling the option one "delete" would promise a disappearance the system
 * can't deliver; labelling the field one "archive" would promise a restore that
 * doesn't exist. Both mistakes generate the same bug report.
 */

// ---------------------------------------------------------------------------
// Option — archive (soft, reversible)
// ---------------------------------------------------------------------------

interface ArchiveAccommodationDialogProps {
  munId: string;
  option: AccommodationOptionRow | null;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveAccommodationDialog({
  munId,
  option,
  onOpenChange,
}: ArchiveAccommodationDialogProps) {
  const [pending, startTransition] = React.useTransition();

  // Driven by `option !== null` rather than a separate boolean so there is
  // exactly one source of truth for "which option, if any". A separate `open`
  // flag could disagree and render a confirm with no subject.
  const open = option !== null;

  function handleArchive() {
    if (!option) return;

    startTransition(async () => {
      const result = await archiveOptionAction(munId, option.id);

      if (!result.ok) {
        toast.error(`Could not archive ${option.name}`, {
          description: result.error,
        });
        return;
      }

      onOpenChange(false);
      toast.success(`${option.name} archived`, {
        description:
          option.taken > 0
            ? `Removed from booking. ${option.taken} existing booking${option.taken === 1 ? "" : "s"} kept.`
            : "Removed from booking. You can restore it any time.",
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive this accommodation option?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{option?.name}</span> stops
            appearing during registration immediately. Nobody new can book it.
          </DialogDescription>
        </DialogHeader>

        {option && option.taken > 0 && (
          <p className="flex items-start gap-xs rounded-sm border border-warning/30 bg-warning/15 px-sm py-xs text-body-md text-warning-text">
            <TriangleAlertIcon
              aria-hidden
              className="mt-px size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span>
              {option.taken} bed{option.taken === 1 ? "" : "s"} already booked.
              Those bookings and their payments stay valid — this only stops new
              ones.
            </span>
          </p>
        )}

        <p className="text-body-md text-body dark:text-muted-foreground">
          This is reversible. Archived options stay in the list, keep their
          custom fields, and can be restored.
        </p>

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
            onClick={handleArchive}
          >
            {pending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <ArchiveIcon aria-hidden />
            )}
            {pending ? "Archiving…" : "Archive option"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Field — delete (hard, irreversible)
// ---------------------------------------------------------------------------

interface DeleteFieldDialogProps {
  munId: string;
  target: { field: FieldRow; optionName: string } | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteFieldDialog({
  munId,
  target,
  onOpenChange,
}: DeleteFieldDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const open = target !== null;

  function handleDelete() {
    if (!target) return;

    startTransition(async () => {
      const result = await deleteFieldAction(munId, target.field.id);

      if (!result.ok) {
        toast.error(`Could not delete ${target.field.label}`, {
          description: result.error,
        });
        return;
      }

      onOpenChange(false);
      toast.success(`${target.field.label} deleted`, {
        description: `Delegates booking ${target.optionName} are no longer asked this.`,
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this field?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{target?.field.label}</span>{" "}
            is removed from {target?.optionName}. Delegates booking it will no
            longer be asked.
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-start gap-xs rounded-sm border border-warning/30 bg-warning/15 px-sm py-xs text-body-md text-warning-text">
          <TriangleAlertIcon
            aria-hidden
            className="mt-px size-4 shrink-0"
            strokeWidth={1.75}
          />
          <span>
            This cannot be undone. Answers delegates already gave stay on their
            bookings, but this question can&rsquo;t be restored — you would have
            to recreate it.
          </span>
        </p>

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
            onClick={handleDelete}
          >
            {pending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <Trash2Icon aria-hidden />
            )}
            {pending ? "Deleting…" : "Delete field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
