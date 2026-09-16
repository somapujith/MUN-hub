import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Copy, MailX } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { getDelegateList, listCommitteesForDelegates } from "@/api/organizer-dashboard";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { PaymentStatus } from "@/types/enums";

const PAYMENT_STATUS_OPTIONS: Array<{ value: PaymentStatus; label: string }> = [
  { value: "PAID", label: "Paid" },
  { value: "PENDING", label: "Pending" },
  { value: "CREATED", label: "Created" },
  { value: "FAILED", label: "Failed" },
  { value: "REFUNDED", label: "Refunded" },
];

const PAGE_SIZE = 100;

/**
 * Communications — SCAFFOLDING ONLY, not a full feature.
 *
 * There is no communications/announcements backend anywhere in this repo
 * (no templates, no send pipeline, no mun_announcements table) — confirmed
 * by searching lib/actions and lib/lifecycle before writing this. Per the
 * task brief, this is the simplest read-only wrapper that doesn't invent new
 * business logic: it surfaces the existing delegate roster
 * (lib/actions/organizer-dashboard.ts#getDelegateList, already shipped and
 * mounted) filterable by committee/payment status, with a client-side
 * "copy emails" convenience for manual outreach in the meantime. No
 * send/compose UI is implemented because nothing backs it — do not count
 * this as a delivered Communications module in review.
 */
export function OrganizerCommunicationsPage() {
  const { munId = "" } = useParams();
  const [committeeId, setCommitteeId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");

  const committeesQuery = useQuery({
    queryKey: queryKeys.committees(munId),
    queryFn: () => listCommitteesForDelegates(munId),
    enabled: Boolean(munId),
  });

  const filters = { committeeId: committeeId || undefined, paymentStatus: paymentStatus || undefined };
  const delegatesQuery = useQuery({
    queryKey: queryKeys.delegates(munId, filters),
    queryFn: () => getDelegateList(munId, { ...filters, limit: PAGE_SIZE }),
    enabled: Boolean(munId),
  });

  const rows = delegatesQuery.data?.results ?? [];
  const emails = useMemo(() => Array.from(new Set(rows.map((row) => row.user.email))), [rows]);

  const copyEmails = async () => {
    if (emails.length === 0) {
      toast.error("No delegates match these filters");
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      toast.success(`Copied ${emails.length} email${emails.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <>
      <Helmet title="Communications" />
      <WorkspacePage
        title="Communications"
        description="Templated announcements and in-app messaging haven't been built yet. This is a read-only delegate directory — for manual outreach — on top of your existing registration data, filterable by committee or payment status."
        actions={
          <Button size="sm" variant="outline" onClick={copyEmails}>
            <Copy aria-hidden /> Copy {emails.length > 0 ? `${emails.length} ` : ""}
            email{emails.length === 1 ? "" : "s"}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-md">
          <div className="flex flex-col gap-xs">
            <label htmlFor="comms-committee" className="text-caption text-muted-foreground">
              Committee
            </label>
            <select
              id="comms-committee"
              className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
              value={committeeId}
              onChange={(event) => setCommitteeId(event.target.value)}
            >
              <option value="">All committees</option>
              {(committeesQuery.data ?? []).map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label htmlFor="comms-payment" className="text-caption text-muted-foreground">
              Payment status
            </label>
            <select
              id="comms-payment"
              className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus | "")}
            >
              <option value="">Any</option>
              {PAYMENT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {delegatesQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading delegates...</p>}
        {delegatesQuery.isError && <p className="text-body-md text-destructive">{delegatesQuery.error.message}</p>}
        {!delegatesQuery.isLoading && rows.length === 0 && !delegatesQuery.isError && (
          <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
            <MailX className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h2 className="mt-md font-display text-title-sm text-ink">No delegates match these filters</h2>
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[40rem] text-left text-body-md">
              <thead className="border-b border-border bg-surface-soft/80 text-muted-foreground">
                <tr>
                  <th className="px-md py-sm font-medium">Name</th>
                  <th className="px-md py-sm font-medium">Email</th>
                  <th className="px-md py-sm font-medium">Committee</th>
                  <th className="px-md py-sm font-medium">Institution</th>
                  <th className="px-md py-sm font-medium">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-md py-sm text-ink">{row.user.name}</td>
                    <td className="px-md py-sm text-muted-foreground">{row.user.email}</td>
                    <td className="px-md py-sm text-muted-foreground">{row.committee?.name ?? "—"}</td>
                    <td className="px-md py-sm text-muted-foreground">{row.user.institution ?? "—"}</td>
                    <td className="px-md py-sm text-muted-foreground">{row.payment[0]?.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {delegatesQuery.data && delegatesQuery.data.total > rows.length && (
          <p className="text-caption text-muted-foreground">
            Showing {rows.length} of {delegatesQuery.data.total} delegates. Narrow the filters to see a different
            slice.
          </p>
        )}
      </WorkspacePage>
    </>
  );
}
