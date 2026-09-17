import { Link } from "react-router";
import { ArrowRightIcon, CalendarIcon, CalendarXIcon, CreditCardIcon, MapPinIcon, ReceiptTextIcon, UsersRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import { hasPassed } from "@/components/registration/deadline";
import { formatPrice } from "@/components/shared/currency";
import { formatDateRange } from "@/components/shared/date-range";
import { cn } from "cn";
import type { RegistrationStatus } from "@/types/enums";
import type { RegistrationWithMun } from "@/types";

/** Registrations that stand, and so have a receipt worth showing. */
const RECEIPT_STATUSES: ReadonlySet<RegistrationStatus> = new Set(["CONFIRMED", "ATTENDED", "NO_SHOW"]);

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

  // A held seat that still has time left can be paid for from here; the pay
  // page reads the registration by id from the query string.
  const canCompletePayment =
    registration.status === "PAYMENT_PENDING" &&
    registration.expiresAt !== null &&
    !hasPassed(registration.expiresAt);
  const hasReceipt = RECEIPT_STATUSES.has(registration.status);
  // A cancelled conference has no public page and no event to show a pass
  // at, but the registration (and its receipt) stays visible.
  const conferenceCancelled = mun.status === "CANCELLED";
  const showPass = !conferenceCancelled && ["CONFIRMED", "ATTENDED", "NO_SHOW"].includes(registration.status);

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
              {conferenceCancelled ? (
                mun.name
              ) : (
                // Stretched link: the whole card is the hit target, but the
                // accessible name stays the MUN title only.
                <Link
                  to={`/mun/${mun.slug}`}
                  className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {mun.name}
                </Link>
              )}
            </h3>
            {conferenceCancelled && (
              <Badge variant="outline" className={getToneClassName("destructive")}>
                <CalendarXIcon className="size-3" strokeWidth={1.75} aria-hidden />
                Conference cancelled
              </Badge>
            )}
            <RegistrationStatusChip status={registration.status} />
            {registration.registrationGroupId && (
              <Badge variant="outline" className={getToneClassName("muted")}>
                <UsersRoundIcon className="size-3" strokeWidth={1.75} aria-hidden />
                Group registration
              </Badge>
            )}
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

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-sm sm:flex-col sm:flex-nowrap sm:items-end sm:justify-start sm:gap-xs">
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
            ) : hasReceipt ? (
              <span className="text-label-md text-ink">Free</span>
            ) : (
              <span className="text-body-md text-muted-foreground">No payment yet</span>
            )}
          </div>

          {/* `relative z-10` lifts these above the card's stretched link so
              they stay independently clickable. */}
          {showPass && (
            <Link
              to={`/dashboard/registrations/${registration.id}/pass`}
              className="relative z-10 rounded-sm text-body-md font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              View pass
            </Link>
          )}

          {canCompletePayment ? (
            <Button
              size="sm"
              className="relative z-10"
              render={
                <Link
                  to={`/register/${mun.slug}/pay?registrationId=${encodeURIComponent(registration.id)}`}
                />
              }
            >
              <CreditCardIcon aria-hidden />
              Complete payment
            </Button>
          ) : hasReceipt ? (
            <Link
              to={`/dashboard/registrations/${encodeURIComponent(registration.id)}/receipt`}
              className="relative z-10 inline-flex items-center gap-xxs rounded-sm text-body-md text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ReceiptTextIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
              Receipt
              <span className="sr-only"> for {mun.name}</span>
            </Link>
          ) : conferenceCancelled ? null : (
            <span
              aria-hidden
              className="hidden items-center gap-xxs text-body-md text-link sm:inline-flex"
            >
              View MUN
              <ArrowRightIcon className="size-3.5" strokeWidth={1.75} />
            </span>
          )}

          {/* Head-only: a claimed teammate's own row also carries
              registrationGroupId (that's what drives the "Group
              registration" badge above), but only the head can manage the
              team — getGroupRoster 403s anyone else. */}
          {registration.registrationGroupId && registration.isGroupHead && (
            <Link
              to={`/dashboard/groups/${registration.registrationGroupId}`}
              className="relative z-10 inline-flex items-center gap-xxs rounded-sm text-body-md text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <UsersRoundIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
              Manage your team
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
