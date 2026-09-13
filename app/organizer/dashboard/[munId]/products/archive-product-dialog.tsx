"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArchiveIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { archiveProductAction } from "./actions";
import type { ProductRow } from "./queries";

/**
 * Destructive confirm for archiving a product.
 *
 * Says ARCHIVE, not delete, on purpose. `deleteRegistrationProduct` is a soft
 * delete — it sets `status = 'inactive'` and leaves the row, because
 * `registrations.registrationProductId` is a NOT NULL FK carrying payment
 * history. Labelling that "delete" would promise a disappearance the system
 * can't deliver, and the organizer would file a bug when the greyed row stays.
 *
 * The seat count is surfaced in the confirm body because archiving a product
 * that already sold seats is a materially different act from archiving an
 * empty one — those delegates keep their registrations, and the organizer
 * should see that before they click.
 */

interface ArchiveProductDialogProps {
  munId: string;
  product: ProductRow | null;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveProductDialog({
  munId,
  product,
  onOpenChange,
}: ArchiveProductDialogProps) {
  const [pending, startTransition] = React.useTransition();

  // The dialog is driven by `product !== null` rather than a separate boolean
  // so there is exactly one source of truth for "which product, if any". A
  // separate `open` flag could disagree with `product` and render a confirm
  // with no subject.
  const open = product !== null;

  function handleArchive() {
    if (!product) return;

    startTransition(async () => {
      const result = await archiveProductAction(munId, product.id);

      if (!result.ok) {
        toast.error(`Could not archive ${product.name}`, {
          description: result.error,
        });
        return;
      }

      onOpenChange(false);
      toast.success(`${product.name} archived`, {
        description:
          product.taken > 0
            ? `Removed from sale. ${product.taken} existing registration${product.taken === 1 ? "" : "s"} kept.`
            : "Removed from sale. You can restore it any time.",
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive this product?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{product?.name}</span> stops
            appearing on the registration page immediately. Nobody new can buy
            it.
          </DialogDescription>
        </DialogHeader>

        {product && product.taken > 0 && (
          <p className="flex items-start gap-xs rounded-sm border border-warning/30 bg-warning/15 px-sm py-xs text-body-md text-warning-text">
            <TriangleAlertIcon
              aria-hidden
              className="mt-px size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span>
              {product.taken} seat{product.taken === 1 ? "" : "s"} already
              taken. Those registrations and their payments stay valid — this
              only stops new sales.
            </span>
          </p>
        )}

        <p className="text-body-md text-body dark:text-muted-foreground">
          This is reversible. Archived products stay in the list and can be
          restored.
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
            {pending ? "Archiving…" : "Archive product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
