

import { cn } from "cn";
import { formatPrice } from "@/components/shared/currency";
import type { ProductWithAvailability } from "@/components/registration/types";

interface ProductOptionProps {
  entry: ProductWithAvailability;
  checked: boolean;
  onSelect: (productId: string) => void;
}

/**
 * Selectable registration pass. A real `<input type="radio">` carries the
 * semantics (keyboard, screen reader, native focus ring) and the visible card
 * is its styled label — so this stays fully accessible without ARIA patching.
 *
 * Sold-out and deadline-passed options render disabled but at full opacity:
 * this is an informational disabled state, and `opacity-50` on informational
 * disabled content fails contrast badly.
 */
export function ProductOption({ entry, checked, onSelect }: ProductOptionProps) {
  const { product, available, capacity, deadlinePassed } = entry;
  const soldOut = available === 0;
  const disabled = soldOut || deadlinePassed;
  const scarce = !disabled && available <= Math.max(3, Math.ceil(capacity * 0.1));

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
        name="product-option"
        value={product.id}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(product.id)}
        className="sr-only"
      />

      {/* Radio marker — drawn, not native, so it matches the hairline system. */}
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
          <span className="text-label-md text-ink">{product.name}</span>
          <span className="font-mono text-label-md tabular-nums text-ink">
            {formatPrice(product.price)}
          </span>
        </span>

        <span className="text-body-md text-muted-foreground">
          {soldOut
            ? "Sold out — all seats taken"
            : deadlinePassed
              ? "Registration deadline has passed"
              : `${available} of ${capacity} seats available`}
        </span>

        {scarce && (
          <span className="text-body-md font-medium text-destructive-text">
            Only {available} left
          </span>
        )}
      </span>
    </label>
  );
}
