import { useId, useState, type FormEvent } from "react";
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

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  reasonLabel?: string;
  placeholder?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * A destructive confirmation that requires a written reason (suspending a
 * MUN or a staff account, cancelling a conference). The reason goes to the
 * audit trail, so an empty one is refused before anything is sent.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  isPending,
  reasonLabel = "Reason",
  placeholder = "Recorded in the audit log",
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);
  const missing = reason.trim().length === 0;

  // Start every opening empty. The dialog stays mounted between targets, and
  // the parent closes it after a successful mutation by flipping `open` back
  // to false — which never reaches `close()`, because `onOpenChange` fires
  // only for user-initiated closes. Without this the next suspension or
  // cancellation would open already filled in with the previous target's
  // reason, and that reason is what lands in the audit log.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason("");
      setShowError(false);
    }
  }

  const close = () => {
    setReason("");
    setShowError(false);
    onClose();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (missing) {
      setShowError(true);
      document.getElementById(fieldId)?.focus();
      return;
    }
    onConfirm(reason.trim());
  };

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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-xs">
            <Label htmlFor={fieldId}>{reasonLabel}</Label>
            <textarea
              id={fieldId}
              className={adminTextareaClassName}
              value={reason}
              maxLength={500}
              placeholder={placeholder}
              aria-invalid={showError && missing ? true : undefined}
              aria-describedby={showError && missing ? `${fieldId}-error` : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                if (event.target.value.trim()) setShowError(false);
              }}
            />
            {showError && missing && (
              <p id={`${fieldId}-error`} role="alert" className="text-body-md text-destructive">
                A reason is required.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
              {isPending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
