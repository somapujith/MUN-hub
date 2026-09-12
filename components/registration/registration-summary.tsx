"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { formatPrice } from "@/components/shared/currency";
import type { ProductWithAvailability } from "@/components/registration/registration-form";

interface RegistrationSummaryProps {
  munName: string;
  slug: string;
  selected?: ProductWithAvailability;
  committeeName?: string;
  portfolioName?: string;
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
      </dl>

      <div className="flex items-baseline justify-between gap-md border-t border-border pt-md">
        <span className="text-label-md text-ink">Total</span>
        <span className="font-mono text-title-sm tabular-nums text-ink">
          {selected ? formatPrice(selected.product.price) : "—"}
        </span>
      </div>

      <Link
        href={`/mun/${slug}`}
        className="inline-flex items-center gap-xs text-body-md text-link underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        Back to conference
      </Link>
    </aside>
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
