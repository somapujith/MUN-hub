import { ChevronRightIcon } from "lucide-react";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { PaymentStatusChip } from "@/components/dashboard/payment-status-chip";
import type { DelegateRow } from "@/lib/actions/organizer-dashboard";

/**
 * The delegate roster table — PRD § 17's `ID | Name | Committee | Portfolio |
 * Payment` shape, widened to the columns `DelegateRow` actually carries.
 *
 * COLUMNS ARE DERIVED FROM THE REAL ROW, NOT THE PRD.
 * `DelegateRow` is `Awaited<ReturnType<typeof queryDelegates>>[number]` — a
 * `registrations` row with `user`, `committee`, `portfolio`,
 * `registrationProduct` and `payment` joined. So:
 *   - "ID" is `registrations.id`, a uuid, not the PRD's pretty `MUN1021`
 *     sequence. There is no human-facing registration number in the schema, so
 *     the first 8 characters are shown in mono as a copyable handle rather
 *     than inventing a format the database can't reproduce.
 *   - `committeeId` / `portfolioId` are NULLABLE and are null for every row
 *     the registration flow currently writes (allocation happens later, and
 *     the allocation action doesn't exist yet). "Unassigned" is therefore the
 *     expected state, not an error state, and is styled as quiet muted text.
 *   - `payment` is a `many` relation (array) even though `payments.registration_id`
 *     is UNIQUE. The newest row wins; an empty array means no order was ever
 *     created, which is a real state for a PENDING registration.
 *
 * READ-ONLY BY CONSTRUCTION. PRD § 17 lists Edit allocation / Assign committee
 * / Assign portfolio / Cancel / Refund / Export / Contact — none of those have
 * a backing action in `lib/actions/*`, so none of them are rendered, not even
 * disabled. The only affordance is the native `<details>` expander, which
 * shows more of the data already fetched for the row.
 *
 * SERVER COMPONENT. The expander is a native `<details>`, so a 300-delegate
 * roster ships zero client JS.
 */

interface DelegateTableProps {
  rows: DelegateRow[];
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** `payments.registration_id` is unique, but the relation is `many`. */
function latestPayment(row: DelegateRow) {
  return row.payment.reduce<DelegateRow["payment"][number] | undefined>(
    (latest, payment) =>
      !latest || payment.createdAt > latest.createdAt ? payment : latest,
    undefined,
  );
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // A hand-entered currency code on a registration product shouldn't 500 the
    // whole roster.
    return `${currency} ${amount}`;
  }
}

function Unassigned() {
  return <span className="text-muted-foreground italic">Unassigned</span>;
}

/** Label/value pair inside the expanded detail panel. */
function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-body-md text-body dark:text-foreground">{children}</span>
    </div>
  );
}

/**
 * `formResponses` is untyped `jsonb` — the registration form builder isn't
 * built, so its shape is whatever the funnel wrote. Rendered defensively as
 * flat key/value pairs; anything non-primitive is JSON-stringified rather than
 * crashing the row.
 */
function FormResponses({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-xs">
      <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
        Form responses
      </span>
      <dl className="grid gap-x-lg gap-y-xs sm:grid-cols-2">
        {entries.map(([key, val]) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-muted-foreground">{key}</dt>
            <dd className="text-body-md break-words text-body dark:text-foreground">
              {typeof val === "string" || typeof val === "number" || typeof val === "boolean"
                ? String(val)
                : JSON.stringify(val)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DelegateRowCard({ row }: { row: DelegateRow }) {
  const payment = latestPayment(row);

  return (
    <details className="group/row border-b border-border last:border-b-0 open:bg-surface-soft/60 dark:open:bg-card">
      <summary
        className="grid cursor-pointer list-none grid-cols-[auto_1fr] items-start gap-x-sm gap-y-xs px-md py-sm transition-colors outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:-ring-offset-2 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center dark:hover:bg-card [&::-webkit-details-marker]:hidden"
        aria-label={`Registration detail for ${row.user.name}`}
      >
        <ChevronRightIcon
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open/row:rotate-90 md:mt-0"
          strokeWidth={1.75}
        />

        {/* Name + id. PRD's "ID" column, but the schema's uuid. */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-body-md font-medium text-ink">
            {row.user.name}
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {row.id.slice(0, 8)}
          </span>
        </div>

        <div className="min-w-0 truncate text-body-md text-body dark:text-muted-foreground">
          <span className="text-muted-foreground md:hidden">Committee: </span>
          {row.committee?.name ?? <Unassigned />}
        </div>

        <div className="min-w-0 truncate text-body-md text-body dark:text-muted-foreground">
          <span className="text-muted-foreground md:hidden">Portfolio: </span>
          {row.portfolio?.name ?? <Unassigned />}
        </div>

        <div className="col-start-2 md:col-start-auto">
          <RegistrationStatusChip status={row.status} />
        </div>

        <div className="col-start-2 md:col-start-auto md:justify-self-end">
          {payment ? (
            <PaymentStatusChip status={payment.status} />
          ) : (
            <span className="text-body-md text-muted-foreground">No payment</span>
          )}
        </div>
      </summary>

      <div className="grid gap-md border-t border-border bg-surface-soft px-md py-md sm:grid-cols-2 lg:grid-cols-3 dark:bg-background/40">
        <DetailField label="Registration ID">
          <span className="font-mono text-[12px] break-all">{row.id}</span>
        </DetailField>
        <DetailField label="Email">
          <span className="break-all">{row.user.email}</span>
        </DetailField>
        <DetailField label="Phone">{row.user.phone ?? "—"}</DetailField>
        <DetailField label="Institution">{row.user.institution ?? "—"}</DetailField>
        <DetailField label="Pass">
          {row.registrationProduct.name}
          <span className="text-muted-foreground">
            {" · "}
            {formatAmount(
              row.registrationProduct.price,
              row.registrationProduct.currency,
            )}
          </span>
        </DetailField>
        <DetailField label="Registered">
          {DATE_TIME_FORMAT.format(row.createdAt)}
        </DetailField>
        {row.committee?.agenda && (
          <DetailField label="Committee agenda">{row.committee.agenda}</DetailField>
        )}
        {row.portfolio?.type && (
          <DetailField label="Portfolio type">{row.portfolio.type}</DetailField>
        )}
        {payment && (
          <>
            <DetailField label="Amount paid">
              {formatAmount(payment.amount, row.registrationProduct.currency)}
            </DetailField>
            <DetailField label="Payment reference">
              <span className="font-mono text-[12px] break-all">
                {payment.providerPaymentId ?? payment.providerOrderId}
              </span>
            </DetailField>
            <DetailField label="Payment updated">
              {DATE_TIME_FORMAT.format(payment.updatedAt)}
            </DetailField>
          </>
        )}
        {row.expiresAt && row.status === "PAYMENT_PENDING" && (
          <DetailField label="Hold expires">
            {DATE_TIME_FORMAT.format(row.expiresAt)}
          </DetailField>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <FormResponses value={row.formResponses} />
        </div>
      </div>
    </details>
  );
}

export function DelegateTable({ rows }: DelegateTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {/* Column header. Desktop only — below `md` each row re-flows into a
          stacked card with inline labels, where a header strip would be a lie. */}
      <div
        aria-hidden
        className="hidden grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-sm border-b border-border bg-surface-soft px-md py-xs text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase md:grid dark:bg-background/40"
      >
        <span className="size-3.5" />
        <span>Delegate</span>
        <span>Committee</span>
        <span>Portfolio</span>
        <span>Registration</span>
        <span className="justify-self-end">Payment</span>
      </div>

      <div role="list">
        {rows.map((row) => (
          <DelegateRowCard key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
