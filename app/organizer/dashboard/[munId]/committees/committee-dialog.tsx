"use client";

import * as React from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCommitteeAction,
  updateCommitteeAction,
  type CommitteeFormValues,
} from "./actions";
import type { CommitteeRow } from "./types";
import { fieldClassName, FieldHint } from "./form-field";

/**
 * Create / edit a committee.
 *
 * FIELDS — exactly `CreateCommitteeInput`: name, capacity, agenda?,
 * description?. PRD § 12 also lists "Assign EB", "Close committee
 * registration" and "Enable waitlists"; none of those exist on the committee
 * row or on any action in the frozen contract, so they are not rendered. A
 * control with nowhere to submit is worse than an absent one.
 *
 * MOUNT KEYING — the caller renders this with `key={committee?.id ?? "new"}`.
 * The inputs are uncontrolled (`defaultValue`), and an uncontrolled input
 * ignores a `defaultValue` that changes after mount. Without the key, opening
 * "edit" on committee A, closing, then opening "edit" on committee B would
 * re-use the same DOM node and show A's values while submitting against B's
 * id. Keying forces a fresh mount per edited row.
 */

interface CommitteeDialogProps {
  munId: string;
  /** Absent = create mode. */
  committee?: CommitteeRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CAPACITY_MAX = 100_000;

export function CommitteeDialog({
  munId,
  committee,
  open,
  onOpenChange,
}: CommitteeDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = committee !== undefined;
  const fieldId = committee?.id ?? "new";

  function handleSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const capacityRaw = String(formData.get("capacity") ?? "").trim();
    const capacity = Number(capacityRaw);

    // Client-side guard is UX only — the DB's NOT NULL / integer column is the
    // real constraint, and the action surfaces whatever it rejects.
    if (name.length === 0) {
      setError("Give the committee a name.");
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > CAPACITY_MAX) {
      setError(`Capacity must be a whole number between 0 and ${CAPACITY_MAX}.`);
      return;
    }

    const values: CommitteeFormValues = {
      name,
      capacity,
      agenda: String(formData.get("agenda") ?? ""),
      description: String(formData.get("description") ?? ""),
    };

    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateCommitteeAction(munId, committee.id, values)
        : await createCommitteeAction(munId, values);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      toast.success(
        isEdit ? `${result.data.name} updated` : `${result.data.name} created`,
        {
          description: isEdit
            ? "Committee details saved."
            : "Add portfolios to it from the committee row.",
        },
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${committee.name}` : "New committee"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes are saved to the live conference configuration."
              : "Capacity can be adjusted later — portfolios are added once the committee exists."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-md">
          <div className="grid gap-md sm:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 flex-col gap-xs">
              <Label htmlFor={`committee-name-${fieldId}`}>Committee name</Label>
              <Input
                id={`committee-name-${fieldId}`}
                name="name"
                required
                maxLength={200}
                autoComplete="off"
                disabled={pending}
                defaultValue={committee?.name ?? ""}
                placeholder="United Nations Security Council"
              />
            </div>

            <div className="flex flex-col gap-xs sm:w-32">
              <Label htmlFor={`committee-capacity-${fieldId}`}>Capacity</Label>
              <Input
                id={`committee-capacity-${fieldId}`}
                name="capacity"
                type="number"
                inputMode="numeric"
                min={0}
                max={CAPACITY_MAX}
                step={1}
                required
                disabled={pending}
                defaultValue={committee?.capacity ?? 0}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="flex flex-col gap-xs">
            <Label htmlFor={`committee-agenda-${fieldId}`}>Agenda</Label>
            <textarea
              id={`committee-agenda-${fieldId}`}
              name="agenda"
              rows={2}
              maxLength={500}
              disabled={pending}
              className={fieldClassName}
              defaultValue={committee?.agenda ?? ""}
              placeholder="The question of maritime security in the Gulf of Aden"
            />
            <FieldHint>Shown on the public MUN page. Optional.</FieldHint>
          </div>

          <div className="flex flex-col gap-xs">
            <Label htmlFor={`committee-description-${fieldId}`}>
              Description
            </Label>
            <textarea
              id={`committee-description-${fieldId}`}
              name="description"
              rows={3}
              maxLength={2000}
              disabled={pending}
              className={fieldClassName}
              defaultValue={committee?.description ?? ""}
              placeholder="Difficulty level, expected experience, procedure notes."
            />
            <FieldHint>Optional.</FieldHint>
          </div>

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
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              {pending
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Create committee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
