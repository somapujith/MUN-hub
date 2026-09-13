"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BedDoubleIcon,
  CalendarIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  HashIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccommodationOptionDialog } from "./accommodation-option-dialog";
import { AccommodationFieldDialog } from "./accommodation-field-dialog";
import {
  ArchiveAccommodationDialog,
  DeleteFieldDialog,
} from "./archive-accommodation-dialog";
import { restoreOptionAction } from "./actions";
import type {
  AccommodationOptionRow,
  AccommodationPageData,
  FieldRow,
} from "./queries";
import type { AccommodationFieldType } from "@/lib/db/schema-enums";

/**
 * The Accommodation module body.
 *
 * LAYOUT DIVERGES FROM `products/product-table.tsx` ON PURPOSE. Registration
 * products are a flat, genuinely tabular list (five short columns compared down
 * the column), so that module renders a real `<table>` at `lg`. Accommodation
 * options are NOT flat — each one owns a variable-length list of custom fields
 * that has to be readable and editable in place. A row that expands into a
 * nested editor cannot live in a `<table>` without either `colspan` gymnastics
 * or breaking the row/column semantics screen readers rely on.
 *
 * So this uses the expandable-card pattern from
 * `committees/committee-board.tsx`, which solves exactly this shape
 * (committee -> portfolios). Multiple options can be open at once: an organizer
 * cross-checks field lists between options.
 *
 * The expanded panel stays MOUNTED and `hidden` rather than unmounting, so the
 * panel DOM (and any focus inside it) survives a collapse and `aria-controls`
 * always resolves to a real element.
 */

interface AccommodationTableProps {
  munId: string;
  data: AccommodationPageData;
}

/** `null` = closed, `"new"` = create, a row = edit that option. */
type OptionDialogState = AccommodationOptionRow | "new" | null;

interface FieldDialogState {
  option: AccommodationOptionRow;
  /** Omitted when adding a new field to `option`. */
  field?: FieldRow;
}

export function AccommodationTable({ munId, data }: AccommodationTableProps) {
  const [optionDialog, setOptionDialog] = React.useState<OptionDialogState>(null);
  const [fieldDialog, setFieldDialog] = React.useState<FieldDialogState | null>(
    null,
  );
  const [archiveTarget, setArchiveTarget] =
    React.useState<AccommodationOptionRow | null>(null);
  const [deleteFieldTarget, setDeleteFieldTarget] = React.useState<{
    field: FieldRow;
    optionName: string;
  } | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [restoringId, setRestoringId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  function toggleExpanded(optionId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  function handleRestore(option: AccommodationOptionRow) {
    setRestoringId(option.id);
    startTransition(async () => {
      const result = await restoreOptionAction(munId, option.id);
      setRestoringId(null);

      if (!result.ok) {
        toast.error(`Could not restore ${option.name}`, {
          description: result.error,
        });
        return;
      }
      toast.success(`${option.name} restored`, {
        description: "Bookable again during registration.",
      });
    });
  }

  const { options, totals } = data;

  return (
    <div className="flex flex-col gap-lg">
      <SummaryStrip totals={totals} />

      {options.length === 0 ? (
        <EmptyState onCreate={() => setOptionDialog("new")} />
      ) : (
        <ul className="flex flex-col gap-sm">
          {options.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              expanded={expanded.has(option.id)}
              restoring={restoringId === option.id}
              onToggle={() => toggleExpanded(option.id)}
              onEdit={() => setOptionDialog(option)}
              onArchive={() => setArchiveTarget(option)}
              onRestore={() => handleRestore(option)}
              onAddField={() => setFieldDialog({ option })}
              onEditField={(field) => setFieldDialog({ option, field })}
              onDeleteField={(field) =>
                setDeleteFieldTarget({ field, optionName: option.name })
              }
            />
          ))}
        </ul>
      )}

      {/*
        One dialog instance for both create and edit. `option` is undefined in
        create mode; the dialog keys its fields on the option id so switching
        targets refreshes the uncontrolled defaults.
      */}
      <AccommodationOptionDialog
        munId={munId}
        option={
          optionDialog === "new" ? undefined : (optionDialog ?? undefined)
        }
        open={optionDialog !== null}
        onOpenChange={(open) => {
          if (!open) setOptionDialog(null);
        }}
      />

      {/*
        Keyed by the field being edited (or "new" per option) and only mounted
        while open. The field dialog holds `fieldType`, `choices` and `required`
        in `useState`, whose initialisers run ONCE per mount — without this key,
        editing field A then field B would carry A's type and choice list into
        B's form. A key on the component is the whole fix.
      */}
      {fieldDialog && (
        <AccommodationFieldDialog
          key={fieldDialog.field?.id ?? `new-${fieldDialog.option.id}`}
          munId={munId}
          optionId={fieldDialog.option.id}
          optionName={fieldDialog.option.name}
          field={fieldDialog.field}
          nextDisplayOrder={nextDisplayOrder(fieldDialog.option.fields)}
          open
          onOpenChange={(open) => {
            if (!open) setFieldDialog(null);
          }}
        />
      )}

      <ArchiveAccommodationDialog
        munId={munId}
        option={archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      />

      <DeleteFieldDialog
        munId={munId}
        target={deleteFieldTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteFieldTarget(null);
        }}
      />
    </div>
  );
}

/**
 * Exposed so the page header's primary action can open the same create dialog
 * the empty state does. The header lives in a server component
 * (`<WorkspacePage actions>`), so it needs its own client trigger rather than
 * reaching into this component's state.
 */
export function AddAccommodationButton({ munId }: { munId: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add option
      </Button>
      <AccommodationOptionDialog
        munId={munId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/** One past the current highest, so a new field lands at the end of the list. */
function nextDisplayOrder(fields: readonly FieldRow[]): number {
  if (fields.length === 0) return 0;
  return Math.max(...fields.map((field) => field.displayOrder)) + 1;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryStrip({ totals }: { totals: AccommodationPageData["totals"] }) {
  /*
    A booked bed must never read as "0%". 1 of 220 rounds to zero, which is
    indistinguishable from having booked nothing — the one number an organizer
    would act on. Floor any non-zero share at "<1%" instead.
  */
  const utilisation = formatUtilisation(totals.taken, totals.capacity);

  const stats = [
    { label: "Active options", value: String(totals.activeCount) },
    { label: "Total beds", value: totals.capacity.toLocaleString("en-IN") },
    { label: "Beds booked", value: totals.taken.toLocaleString("en-IN") },
    { label: "Beds left", value: totals.available.toLocaleString("en-IN") },
    { label: "Utilisation", value: utilisation },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            "flex flex-col gap-xxs bg-background px-md py-sm dark:bg-card",
            // Five stats into a 2- or 3-column grid leaves a dead cell on the
            // last row that reads as a missing stat. The final item spans it.
            index === stats.length - 1 && "col-span-2 sm:col-span-1",
          )}
        >
          <dt className="text-[12px] leading-[1.35] font-medium tracking-[0.16px] text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="font-display text-title-md tabular-nums text-ink">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Option card
// ---------------------------------------------------------------------------

interface OptionCardProps {
  option: AccommodationOptionRow;
  expanded: boolean;
  restoring: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddField: () => void;
  onEditField: (field: FieldRow) => void;
  onDeleteField: (field: FieldRow) => void;
}

function OptionCard({
  option,
  expanded,
  restoring,
  onToggle,
  onEdit,
  onArchive,
  onRestore,
  onAddField,
  onEditField,
  onDeleteField,
}: OptionCardProps) {
  const panelId = `accommodation-panel-${option.id}`;
  const headingId = `accommodation-heading-${option.id}`;
  const archived = option.status !== "active";

  return (
    <li
      className={cn(
        "rounded-md border border-border bg-background transition-[border-color] duration-150 dark:bg-card",
        expanded && "border-border-strong",
        archived && "bg-surface-soft/60 dark:bg-muted/20",
      )}
    >
      <div className="flex flex-wrap items-start gap-sm p-md sm:flex-nowrap">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="mt-0.5 shrink-0"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "transition-transform duration-150 ease-out motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          <span className="sr-only">
            {expanded ? "Collapse" : "Expand"} {option.name}
          </span>
        </Button>

        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-xs">
            <h2
              id={headingId}
              className={cn(
                "min-w-0 font-display text-title-sm text-ink",
                archived && "text-muted-foreground line-through",
              )}
            >
              {option.name}
            </h2>
            {archived && <Badge variant="secondary">Archived</Badge>}
            <Badge variant="secondary" className="tabular-nums">
              {option.fields.length}{" "}
              {option.fields.length === 1 ? "field" : "fields"}
            </Badge>
          </div>

          {option.description && (
            <p className="line-clamp-2 max-w-prose text-body-md text-body dark:text-muted-foreground">
              {option.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-lg gap-y-xs">
            <span className="font-display text-title-sm tabular-nums text-ink">
              {formatPrice(option.price)}
            </span>
            <BedMeter option={option} />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-xs">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <PencilIcon aria-hidden />
            Edit
            <span className="sr-only"> {option.name}</span>
          </Button>

          {archived ? (
            <Button
              size="sm"
              variant="outline"
              disabled={restoring}
              onClick={onRestore}
            >
              <ArchiveRestoreIcon aria-hidden />
              {restoring ? "Restoring…" : "Restore"}
              <span className="sr-only"> {option.name}</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onArchive}
              /*
                Kept as `outline`, not `destructive`: a list with a solid red
                button on every row reads as an alarm state. The destructive
                framing belongs in the confirm dialog, where the consequence is
                actually being decided. Same call as `products/product-table`.
              */
            >
              <ArchiveIcon aria-hidden />
              Archive
              <span className="sr-only"> {option.name}</span>
            </Button>
          )}
        </div>
      </div>

      {/*
        Kept mounted but `hidden` so the panel's DOM (and any focus inside it)
        is stable across expand/collapse, and `aria-controls` always resolves.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        hidden={!expanded}
        className="border-t border-border px-md py-md"
      >
        <FieldList
          option={option}
          onAdd={onAddField}
          onEdit={onEditField}
          onDelete={onDeleteField}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

const FIELD_TYPE_META: Record<
  AccommodationFieldType,
  { label: string; icon: LucideIcon }
> = {
  TEXT: { label: "Text", icon: TypeIcon },
  NUMBER: { label: "Number", icon: HashIcon },
  DATE: { label: "Date", icon: CalendarIcon },
  DROPDOWN: { label: "Dropdown", icon: ListIcon },
  CHECKBOX: { label: "Checkboxes", icon: CheckSquareIcon },
};

interface FieldListProps {
  option: AccommodationOptionRow;
  onAdd: () => void;
  onEdit: (field: FieldRow) => void;
  onDelete: (field: FieldRow) => void;
}

function FieldList({ option, onAdd, onEdit, onDelete }: FieldListProps) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center justify-between gap-xs">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h3 className="text-body-md font-medium text-ink">Custom fields</h3>
          <p className="text-[12px] leading-[1.35] text-muted-foreground">
            Extra questions asked when a delegate books this option.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <PlusIcon aria-hidden />
          Add field
          <span className="sr-only"> to {option.name}</span>
        </Button>
      </div>

      {option.fields.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-md py-sm text-body-md text-muted-foreground">
          No custom fields. Delegates just pick this option and pay — add a
          field if you need their meal preference, arrival date or roommate
          request.
        </p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {option.fields.map((field) => {
            const meta = FIELD_TYPE_META[field.fieldType];
            const Icon = meta.icon;

            return (
              <li
                key={field.id}
                className="flex flex-wrap items-start gap-sm rounded-sm border border-border bg-surface-soft px-md py-sm sm:flex-nowrap sm:items-center dark:bg-muted/20"
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm bg-background text-muted-foreground sm:mt-0 dark:bg-card"
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-xxs">
                  <div className="flex flex-wrap items-center gap-xs">
                    <span className="min-w-0 text-body-md font-medium text-ink">
                      {field.label}
                    </span>
                    <Badge variant="secondary">{meta.label}</Badge>
                    {field.required && (
                      <Badge variant="secondary">Required</Badge>
                    )}
                  </div>

                  {field.choices.length > 0 && (
                    <ul className="flex flex-wrap gap-xxs">
                      {field.choices.map((choice) => (
                        <li
                          key={choice}
                          className="rounded-pill border border-border bg-background px-xs py-[2px] text-[12px] leading-[1.35] text-body dark:bg-card dark:text-muted-foreground"
                        >
                          {choice}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-xxs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(field)}
                    aria-label={`Edit ${field.label}`}
                  >
                    <PencilIcon aria-hidden />
                    <span className="sr-only sm:not-sr-only">Edit</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onDelete(field)}
                    className="text-destructive-text! hover:bg-destructive/10"
                    aria-label={`Delete ${field.label}`}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * Bed availability, three-channel: a bar (position), a ratio (number) and a
 * colour. Colour alone would fail for the ~8% of men with a red/green
 * deficiency, and a bar alone can't tell 190/200 from 195/200.
 */
function BedMeter({ option }: { option: AccommodationOptionRow }) {
  const { capacity, taken, available } = option;
  const pct = capacity > 0 ? Math.min((taken / capacity) * 100, 100) : 0;
  const full = available === 0 && capacity > 0;
  const tight = !full && capacity > 0 && available / capacity <= 0.1;

  return (
    <div className="flex min-w-0 flex-1 basis-48 flex-col gap-xxs">
      <div className="flex items-baseline justify-between gap-xs tabular-nums">
        <span className="text-body-md text-ink">
          {taken.toLocaleString("en-IN")}
          <span className="text-muted-foreground">
            {" / "}
            {capacity.toLocaleString("en-IN")}
          </span>
        </span>
        <span
          className={cn(
            "text-[12px] leading-[1.35] font-medium tracking-[0.16px]",
            full
              ? "text-destructive-text"
              : tight
                ? "text-warning-text"
                : "text-muted-foreground",
          )}
        >
          {full ? "Full" : `${available.toLocaleString("en-IN")} left`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={taken}
        aria-label={`${taken} of ${capacity} beds booked`}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-strong dark:bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-pill transition-[width] duration-300 ease-out motion-reduce:transition-none",
            full ? "bg-destructive" : tight ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl text-center dark:bg-card">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-surface-strong text-muted-foreground dark:bg-muted"
      >
        <BedDoubleIcon strokeWidth={1.5} className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-xs">
        <p className="font-display text-title-sm text-ink">
          No accommodation options yet
        </p>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          Accommodation is optional — skip this entirely if delegates arrange
          their own stay. Add an option and it becomes a paid add-on during
          registration, billed with the pass in one payment.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <PlusIcon aria-hidden />
        Add your first option
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatUtilisation(taken: number, capacity: number): string {
  if (capacity === 0) return "—";
  if (taken === 0) return "0%";
  const pct = (taken / capacity) * 100;
  if (pct < 1) return "<1%";
  if (pct > 99 && taken < capacity) return ">99%";
  return `${Math.round(pct)}%`;
}

/**
 * `accommodationOptions` has no `currency` column (unlike
 * `registrationProducts`, which carries one per row). Accommodation is billed
 * additively into the same order as the registration product, so it is priced
 * in the conference's currency by construction — INR is the platform default
 * and the only thing this row can honestly claim.
 */
function formatPrice(price: number): string {
  if (price === 0) return "Included";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(price);
}
