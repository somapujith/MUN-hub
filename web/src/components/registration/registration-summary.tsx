

import { Link } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import { formatPrice } from "@/components/shared/currency";
import type { ProductWithAvailability } from "@/components/registration/types";

interface RegistrationSummaryProps {
  munName: string;
  slug: string;
  selected?: ProductWithAvailability;
  committeeName?: string;
  portfolioName?: string;
  /** Chosen accommodation, if any. Undefined on the skip path. */
  accommodation?: { name: string; price: number };
  /** True when this MUN sells accommodation at all — controls whether the
   * "Stay" row renders as "None" rather than disappearing. */
  showAccommodationRow?: boolean;
  /**
   * Pass price + accommodation price, summed by the caller.
   *
   * Passed in rather than derived here so there is exactly ONE place the total
   * is computed — the review step and this panel must never be able to
   * disagree about what the student is about to be charged.
   */
  total: number;
}

/**
 * Sticky order summary. `surface-soft` panel on the white canvas — the doc's
 * "color-block first, shadow second" elevation, so no drop shadow here.
 */
export function RegistrationSummary({
  munName,
  slug,
  selected,
  committeeName,
  portfolioName,
  accommodation,
  showAccommodationRow = false,
  total,
}: RegistrationSummaryProps) {
  return (
    <aside className="flex flex-col gap-md rounded-md bg-surface-soft p-lg lg:sticky lg:top-lg">
      <div className="flex flex-col gap-xxs">
        <p className="text-caption uppercase text-muted-foreground">Your registration</p>
        <p className="text-title-sm text-ink">{munName}</p>
      </div>

      <dl className="flex flex-col gap-xs border-t border-border pt-md text-body-md">
        <SummaryRow label="Pass" value={selected?.product.name ?? "Not selected"} />
        {committeeName && <SummaryRow label="Committee" value={committeeName} />}
        {portfolioName && <SummaryRow label="Portfolio" value={portfolioName} />}
        {showAccommodationRow && (
          <SummaryRow label="Stay" value={accommodation?.name ?? "None"} />
        )}
      </dl>

      {/* Line items only once there's more than one — a single-line breakdown
          above an identical total reads as a rendering bug. */}
      {selected && accommodation && (
        <dl className="flex flex-col gap-xs border-t border-border pt-md text-body-md">
          <LineItem label={selected.product.name} amount={selected.product.price} />
          <LineItem label={accommodation.name} amount={accommodation.price} />
        </dl>
      )}

      <div className="flex items-baseline justify-between gap-md border-t border-border pt-md">
        <span className="text-label-md text-ink">Total</span>
        <span className="font-mono text-title-sm tabular-nums text-ink">
          {selected ? formatPrice(total) : "—"}
        </span>
      </div>

      <Link
        to={`/mun/${slug}`}
        className="inline-flex items-center gap-xs text-body-md text-link underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        Back to conference
      </Link>
    </aside>
  );
}

function LineItem({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-md">
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-mono tabular-nums text-ink">{formatPrice(amount)}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-md">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
