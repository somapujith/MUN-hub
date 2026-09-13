import Link from "next/link";
import { XIcon } from "lucide-react";
import { cn } from "cn";

/**
 * Filter rail for the Registrations roster.
 *
 * SERVER COMPONENT ON PURPOSE. Every control is a `<Link>` that rewrites the
 * page's search params, so the section's server component re-runs
 * `getDelegateList(munId, filters)` and the filtering is genuinely server-side
 * against the database, not a client-side `.filter()` over a pre-fetched array.
 * That also means zero client JS on a page whose whole job is rendering rows,
 * and it sidesteps the uncontrolled-`defaultValue` class of bug entirely —
 * there is no form state to drift out of sync with the URL.
 *
 * ONLY TWO FILTERS EXIST HERE, AND THAT IS NOT AN OVERSIGHT.
 * `DelegateFilters` in `lib/actions/organizer-dashboard.ts` is exactly
 * `{ committeeId?: string; paymentStatus?: string }`. PRD § 17 also lists
 * portfolio, registration type, date, institution, city and attendance — none
 * of those are accepted by the frozen action, so building pickers for them
 * would produce controls that either silently do nothing or force client-side
 * filtering that disagrees with the server's result count. They stay out until
 * the backend contract grows them.
 *
 * Chip styling mirrors `components/marketplace/filter-sidebar.tsx`'s
 * `RailOption`, minus the client-side transition state.
 */

/** `payments.status` — `paymentStatusEnum` in `lib/db/schema-enums.ts`. */
export const PAYMENT_STATUS_OPTIONS = [
  "CREATED",
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentStatusOption = (typeof PAYMENT_STATUS_OPTIONS)[number];

export interface CommitteeOption {
  id: string;
  name: string;
}

interface RegistrationFilterBarProps {
  /** `/organizer/dashboard/[munId]/registrations` — the base for every chip. */
  basePath: string;
  committees: CommitteeOption[];
  /** Current `?committee=` value, or "" for no committee filter. */
  selectedCommitteeId: string;
  /** Current `?payment=` value, or "" for no payment filter. */
  selectedPaymentStatus: string;
  /** Row count after filtering — rendered on the active chip of each group. */
  resultCount: number;
}

const PAYMENT_LABELS: Record<PaymentStatusOption, string> = {
  CREATED: "Order created",
  PENDING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

function buildHref(
  basePath: string,
  current: { committee: string; payment: string },
  patch: Partial<{ committee: string; payment: string }>,
): string {
  const next = new URLSearchParams();
  const merged = { ...current, ...patch };
  if (merged.committee) next.set("committee", merged.committee);
  if (merged.payment) next.set("payment", merged.payment);
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function FilterChip({
  href,
  label,
  active,
  count,
}: {
  href: string;
  label: string;
  active: boolean;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center gap-xxs rounded-pill border px-sm py-[5px] text-body-md",
        "transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "border-transparent bg-ink font-medium text-background"
          : "border-border bg-background text-body hover:bg-surface-soft hover:text-ink dark:text-muted-foreground dark:hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {active && count !== undefined && (
        <span className="font-mono text-[11px] leading-[1.45] tabular-nums opacity-70">
          {count}
        </span>
      )}
    </Link>
  );
}

function FilterGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-xs">
      <span className="w-[84px] shrink-0 text-caption uppercase tracking-[0.16px] text-muted-foreground">
        {heading}
      </span>
      {children}
    </div>
  );
}

export function RegistrationFilterBar({
  basePath,
  committees,
  selectedCommitteeId,
  selectedPaymentStatus,
  resultCount,
}: RegistrationFilterBarProps) {
  const current = {
    committee: selectedCommitteeId,
    payment: selectedPaymentStatus,
  };
  const hasFilters = Boolean(selectedCommitteeId || selectedPaymentStatus);

  return (
    <section
      aria-label="Filter registrations"
      className="flex flex-col gap-sm rounded-md border border-border bg-surface-soft px-md py-sm dark:bg-card"
    >
      {committees.length > 0 && (
        <FilterGroup heading="Committee">
          <FilterChip
            href={buildHref(basePath, current, { committee: "" })}
            label="All"
            active={selectedCommitteeId === ""}
            count={resultCount}
          />
          {committees.map((committee) => (
            <FilterChip
              key={committee.id}
              href={buildHref(basePath, current, { committee: committee.id })}
              label={committee.name}
              active={selectedCommitteeId === committee.id}
              count={resultCount}
            />
          ))}
        </FilterGroup>
      )}

      <FilterGroup heading="Payment">
        <FilterChip
          href={buildHref(basePath, current, { payment: "" })}
          label="All"
          active={selectedPaymentStatus === ""}
          count={resultCount}
        />
        {PAYMENT_STATUS_OPTIONS.map((status) => (
          <FilterChip
            key={status}
            href={buildHref(basePath, current, { payment: status })}
            label={PAYMENT_LABELS[status]}
            active={selectedPaymentStatus === status}
            count={resultCount}
          />
        ))}
      </FilterGroup>

      {hasFilters && (
        <div className="border-t border-border pt-xs">
          <Link
            href={basePath}
            className="inline-flex items-center gap-xxs rounded-sm px-xxs py-px text-body-md text-link underline-offset-4 transition-colors duration-150 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
            Clear filters
          </Link>
        </div>
      )}
    </section>
  );
}
