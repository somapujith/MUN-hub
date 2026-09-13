"use client";

import { cn } from "cn";
import { formatPrice } from "@/components/shared/currency";
import type { AccommodationOption } from "@/lib/actions/accommodation";

interface AccommodationOptionCardProps {
  /** `null` renders the "No accommodation" skip card. */
  option: AccommodationOption | null;
  checked: boolean;
  /** Receives `""` for the skip card. */
  onSelect: (optionId: string) => void;
  disabled?: boolean;
}

/**
 * Selectable accommodation card. Structurally identical to `ProductOption` —
 * real `<input type="radio">` carrying the semantics, drawn marker matching the
 * hairline system, `{rounded.md}` card on `surface-soft` when active.
 *
 * Deliberately shares the radio `name` group ("accommodation-option") with the
 * skip card so keyboard arrow navigation walks the whole set including "No
 * accommodation" — a separate control for the skip path would strand it outside
 * the roving tabindex.
 *
 * `name` is set but these inputs are NOT the submission carrier; the selected id
 * travels as a hidden field like every other value in this form.
 */
export function AccommodationOptionCard({
  option,
  checked,
  onSelect,
  disabled = false,
}: AccommodationOptionCardProps) {
  const value = option?.id ?? "";
  const name = option?.name ?? "No accommodation";
  const description =
    option?.description ??
    (option ? null : "I'll arrange my own stay. Nothing is added to your total.");

  return (
    <label
      className={cn(
        "group relative flex cursor-pointer items-start gap-md rounded-md border p-md transition-colors",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        checked && !disabled ? "border-ink bg-surface-soft" : "border-border bg-card",
        !disabled && !checked && "hover:bg-surface-soft",
        disabled && "cursor-not-allowed border-border bg-surface-soft",
      )}
    >
      <input
        type="radio"
        name="accommodation-option"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="sr-only"
      />

      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked && !disabled ? "border-ink" : "border-border-strong",
          disabled && "border-border",
        )}
      >
        <span
          className={cn(
            "size-2.5 rounded-full transition-transform",
            checked && !disabled ? "scale-100 bg-ink" : "scale-0 bg-transparent",
          )}
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-xxs">
        <span className="flex flex-wrap items-baseline justify-between gap-xs">
          <span className="text-label-md text-ink">{name}</span>
          <span className="font-mono text-label-md tabular-nums text-ink">
            {option ? `+ ${formatPrice(option.price)}` : formatPrice(0)}
          </span>
        </span>

        {description && (
          <span className="text-body-md text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  );
}
