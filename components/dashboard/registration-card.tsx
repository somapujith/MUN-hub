import Link from "next/link";
import { ArrowRightIcon, CalendarIcon, MapPinIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import { formatPrice } from "@/components/shared/currency";
import { formatDateRange } from "@/components/shared/date-range";
import { cn } from "cn";
import type { RegistrationWithMun } from "@/lib/actions/student-dashboard";

interface RegistrationCardProps {
  registration: RegistrationWithMun;
  /** Past registrations render de-emphasised — same layout, lower ink weight. */
  muted?: boolean;
}

export function RegistrationCard({ registration, muted = false }: RegistrationCardProps) {
  const { mun, committee, portfolio } = registration;

  // `payment` is a one-to-many relation in the Drizzle schema (the payments
  // table has a UNIQUE constraint on registration_id, so there is at most one
  // row — but the relation still types as an array).
  const paymentRow = registration.payment.at(0);
  const payment = paymentRow
    ? { amount: paymentRow.amount, ...getPaymentStatusMeta(paymentRow.status) }
    : null;

  const location = [mun.city, mun.country].filter(Boolean).join(", ");

  return (
    <Card
      className={cn(
        "relative transition-[border-color,box-shadow] duration-200",
        "hover:border-border-strong focus-within:border-border-strong",
        "hover:shadow-[0_1px_3px_var(--shadow-color)]",
        muted && "bg-surface-soft",
      )}
    >
      <CardContent className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between sm:gap-lg">
        <div className="flex min-w-0 flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-xs">
            <h3 className="min-w-0 font-display text-title-sm text-balance text-ink">
              {/* Stretched link: the whole card is the hit target, but the
                  accessible name stays the MUN title only. */}
              <Link
                href={`/mun/${mun.slug}`}
                className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {mun.name}
              </Link>
            </h3>
            <RegistrationStatusChip status={registration.status} />
          </div>

          <dl className="flex flex-wrap items-center gap-x-md gap-y-xxs text-body-md text-muted-foreground">
            <div className="flex items-center gap-xxs">
              <dt className="sr-only">Dates</dt>
              <CalendarIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <dd className={cn(!mun.startDate && "italic")}>
                {formatDateRange(mun.startDate, mun.endDate)}
              </dd>
            </div>

            <div className="flex items-center gap-xxs">
              <dt className="sr-only">Location</dt>
              <MapPinIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <dd className={cn(!location && "italic")}>{location || "Location TBA"}</dd>
            </div>
          </dl>

          {(committee || portfolio) && (
            <p className="text-body-md text-body">
              {committee?.name}
              {committee && portfolio && (
                <span aria-hidden className="px-xxs text-muted-foreground">
                  ·
                </span>
              )}
              {portfolio?.name}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-sm sm:flex-col sm:items-end sm:justify-start sm:gap-xs">
          {/* Mobile: fee and payment chip share one baseline row. Desktop: they
              stack right-aligned above the "View MUN" affordance. */}
          <div className="flex flex-row items-center gap-xs sm:flex-col sm:items-end sm:gap-xxs">
            {payment ? (
              <>
                <span className="text-label-md tabular-nums text-ink">
                  {formatPrice(payment.amount)}
                </span>
                <span
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-[12px] leading-[1.35] font-medium tracking-[0.16px]",
                    getToneClassName(payment.tone),
                  )}
                >
                  {payment.label}
                </span>
              </>
            ) : (
              <span className="text-body-md text-muted-foreground">No payment yet</span>
            )}
          </div>

          <span
            aria-hidden
            className="hidden items-center gap-xxs text-body-md text-link sm:inline-flex"
          >
            View MUN
            <ArrowRightIcon className="size-3.5" strokeWidth={1.75} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
