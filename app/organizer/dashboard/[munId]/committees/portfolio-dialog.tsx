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
import type { Portfolio } from "@/lib/types";
import {
  createPortfolioAction,
  updatePortfolioAction,
  type PortfolioFormValues,
} from "./actions";
import { FieldHint } from "./form-field";

/**
 * Create / edit a portfolio under one committee.
 *
 * FIELDS — exactly `CreatePortfolioInput`: name, type?, availability?.
 *
 * PRD § 13 asks for country/role, position, availability, restrictions and
 * description. Only three of those have anywhere to go:
 *   - "Country/role"  -> `name`  (the delegation label: "France", "Chairperson")
 *   - "Position"      -> `type`  (a free-text classification; the column is
 *                                 `text`, not an enum, so it stays an input)
 *   - "Availability"  -> `availability` (integer, defaults to 1 in the schema)
 * "Restrictions" and "Description" have NO column on `portfolios` and NO field
 * on `CreatePortfolioInput`/`UpdatePortfolioInput`. They are omitted rather
 * than faked — a form field that silently discards what an organizer typed is
 * a data-loss bug wearing a feature's clothes.
 *
 * Mount keying: same reasoning as `committee-dialog.tsx` — uncontrolled
 * `defaultValue` must not be asked to change after mount, so the caller keys
 * this by the portfolio id being edited.
 */

interface PortfolioDialogProps {
  munId: string;
  committeeId: string;
  committeeName: string;
  /** Absent = create mode. */
  portfolio?: Portfolio;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AVAILABILITY_MAX = 10_000;

export function PortfolioDialog({
  munId,
  committeeId,
  committeeName,
  portfolio,
  open,
  onOpenChange,
}: PortfolioDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = portfolio !== undefined;
  const fieldId = portfolio?.id ?? `new-${committeeId}`;

  function handleSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const availability = Number(
      String(formData.get("availability") ?? "").trim(),
    );

    if (name.length === 0) {
      setError("Give the portfolio a name.");
      return;
    }
    if (
      !Number.isInteger(availability) ||
      availability < 0 ||
      availability > AVAILABILITY_MAX
    ) {
      setError(
        `Availability must be a whole number between 0 and ${AVAILABILITY_MAX}.`,
      );
      return;
    }

    const values: PortfolioFormValues = {
      name,
      type: String(formData.get("type") ?? ""),
      availability,
    };

    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updatePortfolioAction(munId, portfolio.id, values)
        : await createPortfolioAction(munId, committeeId, values);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      toast.success(
        isEdit ? `${result.data.name} updated` : `${result.data.name} added`,
        { description: `In ${committeeName}.` },
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${portfolio.name}` : "New portfolio"}
          </DialogTitle>
          <DialogDescription>
            In <span className="font-medium text-ink">{committeeName}</span>.
            {isEdit
              ? " Changes apply to the live allocation pool."
              : " Delegates pick from this list when they register."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <Label htmlFor={`portfolio-name-${fieldId}`}>Country or role</Label>
            <Input
              id={`portfolio-name-${fieldId}`}
              name="name"
              required
              maxLength={200}
              autoComplete="off"
              disabled={pending}
              defaultValue={portfolio?.name ?? ""}
              placeholder="France"
            />
            <FieldHint>
              What the delegate is assigned — a member state, an NGO, or a named
              individual in a crisis committee.
            </FieldHint>
          </div>

          <div className="grid gap-md sm:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 flex-col gap-xs">
              <Label htmlFor={`portfolio-type-${fieldId}`}>Position</Label>
              <Input
                id={`portfolio-type-${fieldId}`}
                name="type"
                maxLength={100}
                autoComplete="off"
                disabled={pending}
                defaultValue={portfolio?.type ?? ""}
                placeholder="Permanent member"
              />
              <FieldHint>Optional classification.</FieldHint>
            </div>

            <div className="flex flex-col gap-xs sm:w-32">
              <Label htmlFor={`portfolio-availability-${fieldId}`}>Seats</Label>
              <Input
                id={`portfolio-availability-${fieldId}`}
                name="availability"
                type="number"
                inputMode="numeric"
                min={0}
                max={AVAILABILITY_MAX}
                step={1}
                required
                disabled={pending}
                defaultValue={portfolio?.availability ?? 1}
                className="tabular-nums"
              />
              <FieldHint>0 closes it.</FieldHint>
            </div>
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
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add portfolio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
