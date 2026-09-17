import { BedDoubleIcon } from "lucide-react";
import { formatPrice } from "@/components/shared/currency";
import type { PublicAccommodationOption } from "@/types/public-mun";

/**
 * Accommodation options a delegate can add during registration. Prices are
 * per delegate, charged with the registration pass in the same payment.
 */
export function AccommodationList({ options }: { options: PublicAccommodationOption[] }) {
  return (
    <ul className="grid list-none grid-cols-1 gap-md p-0 md:grid-cols-2">
      {options.map((option) => (
        <li key={option.id} className="flex flex-col rounded-md border border-border bg-card p-lg">
          <div className="flex items-start justify-between gap-sm">
            <div className="flex min-w-0 items-center gap-xs">
              <BedDoubleIcon aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-muted-foreground" />
              <h3 className="font-display text-label-md text-ink">{option.name}</h3>
            </div>
            <p className="shrink-0 text-label-md tabular-nums text-ink">{formatPrice(option.price)}</p>
          </div>
          {option.description && (
            <p className="mt-xs text-body-md leading-relaxed text-body dark:text-muted-foreground">
              {option.description}
            </p>
          )}
          {option.capacity > 0 && (
            <p className="mt-auto pt-sm text-body-md tabular-nums text-muted-foreground">
              {option.capacity} {option.capacity === 1 ? "place" : "places"} in total
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
