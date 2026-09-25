import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ArrowLeftIcon, Building2Icon } from "lucide-react";
import { toast } from "sonner";
import { getOrganizerDetail, verifyOrganizerPayout } from "@/api/organizer-admin";
import { queryKeys } from "@/api/query-keys";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { OrganizerBankDetailsCard } from "@/components/admin/organizer-bank-details-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { adminSelectClassName } from "@/lib/admin/styles";
import { formatAdminDate, formatAdminDateTime } from "@/lib/admin/go-live-labels";
import { PAYMENT_GATEWAY_OPTIONS, type OrganizerPayoutStatus, type PaymentGateway } from "@/types/organizer-admin";

const GATEWAY_LABELS: Record<PaymentGateway, string> = {
  CASHFREE: "Cashfree",
  MANUAL: "Manual (bank transfer)",
};

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-md rounded-md border border-border bg-card p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 className="font-display text-title-sm text-ink">{title}</h2>
        {description && <p className="text-body-md text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">{label}</dt>
      <dd className="text-body-md text-ink">{children}</dd>
    </div>
  );
}

/**
 * The gateway verification module. Human-in-the-loop by design (matches the
 * organizer agreement checkbox pattern elsewhere in this console): staff
 * must explicitly confirm the beneficiary was set up in the gateway before
 * the submit button even enables, since `verifyOrganizerPayout` has no way
 * to check that itself.
 *
 * `initialStatus` seeds the display from `getOrganizerDetail`'s own load
 * (`organizer_profiles.payoutVerified`/`paymentGateway`/`payoutVerifiedAt`)
 * so a returning admin sees the real, persisted status immediately, not just
 * whatever happened in the current browser tab. A fresh verify updates the
 * local display right away (for a snappy UI) and also invalidates the
 * detail query, so the two never drift apart on a refetch.
 */
function PayoutVerificationModule({
  organizerId,
  initialStatus,
}: {
  organizerId: string;
  initialStatus: OrganizerPayoutStatus;
}) {
  const queryClient = useQueryClient();
  const [gateway, setGateway] = useState<PaymentGateway | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<OrganizerPayoutStatus>(initialStatus);

  const verifyMutation = useMutation({
    mutationFn: (selected: PaymentGateway) => verifyOrganizerPayout(organizerId, selected),
    onSuccess: async (result) => {
      setStatus(result);
      setConfirmed(false);
      toast.success(`Payout verified via ${GATEWAY_LABELS[result.paymentGateway as PaymentGateway] ?? result.paymentGateway}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminOrganizerDetail(organizerId) });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to verify payout"),
  });

  const canSubmit = gateway !== "" && confirmed && !verifyMutation.isPending;

  return (
    <Section
      title="Payment gateway"
      description="Confirm the organizer is set up as a payout beneficiary in the gateway, then record it here."
    >
      <div className="flex items-center gap-sm">
        {status?.payoutVerified ? (
          <Badge variant="success">
            Payout verified via {GATEWAY_LABELS[(status.paymentGateway as PaymentGateway) ?? "MANUAL"] ?? status.paymentGateway}
            {status.payoutVerifiedAt ? ` on ${formatAdminDateTime(status.payoutVerifiedAt)}` : ""}
          </Badge>
        ) : (
          <Badge variant="warning">Not yet verified</Badge>
        )}
      </div>

      <div className="flex flex-col gap-xs">
        <Label htmlFor="payout-gateway">Gateway</Label>
        <select
          id="payout-gateway"
          className={adminSelectClassName}
          value={gateway}
          onChange={(event) => setGateway(event.target.value as PaymentGateway)}
        >
          <option value="" disabled>
            Select a gateway…
          </option>
          {PAYMENT_GATEWAY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {GATEWAY_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-start gap-sm text-body-md text-body">
        <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} className="mt-0.5" />
        I have set this organizer up as a beneficiary in the selected gateway.
      </label>

      <Button
        type="button"
        size="sm"
        className="self-start"
        disabled={!canSubmit}
        onClick={() => {
          if (gateway !== "") verifyMutation.mutate(gateway);
        }}
      >
        {verifyMutation.isPending ? "Verifying…" : "Verify payout"}
      </Button>
    </Section>
  );
}

/**
 * Everything staff need on one organizer once they've cleared Gate 1: their
 * account, what they entered in onboarding, their payout bank details
 * (behind the same reveal-on-click discipline as the review dialog), and the
 * gateway verification module.
 */
export function AdminOrganizerDetailPage() {
  const { userId = "" } = useParams();

  const detailQuery = useQuery({
    queryKey: queryKeys.adminOrganizerDetail(userId),
    queryFn: () => getOrganizerDetail(userId),
    enabled: userId !== "",
  });

  if (detailQuery.isLoading) {
    return (
      <AdminPageFrame title="Organizer" description="Loading…">
        <div className="flex flex-col gap-sm">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      </AdminPageFrame>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <AdminPageFrame title="Organizer" description="This organizer could not be loaded.">
        <p className="text-body-md text-destructive">
          {detailQuery.error instanceof Error ? detailQuery.error.message : "Organizer not found."}
        </p>
        <Button variant="outline" size="sm" className="self-start" render={<Link to="/admin/organizers" />}>
          <ArrowLeftIcon aria-hidden /> All organizers
        </Button>
      </AdminPageFrame>
    );
  }

  const organizer = detailQuery.data;
  const profile = organizer.profile;

  return (
    <AdminPageFrame title={organizer.name} description={organizer.email}>
      <div className="flex flex-wrap items-center gap-sm">
        <Button variant="outline" size="sm" render={<Link to="/admin/organizers" />}>
          <ArrowLeftIcon aria-hidden /> All organizers
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to={`/admin/muns?organizerId=${organizer.id}&organizerName=${encodeURIComponent(organizer.name)}`}
            />
          }
        >
          <Building2Icon aria-hidden /> This organizer's MUNs
        </Button>
      </div>

      <Section title="Account">
        <dl className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Name">{organizer.name}</Fact>
          <Fact label="Email">
            <span className="break-all">{organizer.email}</span>
          </Fact>
          <Fact label="Institution">{organizer.institution ?? "—"}</Fact>
          <Fact label="Status">
            {organizer.suspended ? (
              <>
                <Badge variant="destructive">Suspended</Badge>
                {organizer.suspendedReason && (
                  <p className="mt-xxs text-muted-foreground">{organizer.suspendedReason}</p>
                )}
              </>
            ) : (
              <Badge variant="success">Active</Badge>
            )}
          </Fact>
          <Fact label="Joined">{formatAdminDate(organizer.createdAt)}</Fact>
        </dl>
      </Section>

      <Section
        title="Onboarding answers"
        description="What this organizer entered in the onboarding wizard (their first MUN's answers)."
      >
        {profile ? (
          <dl className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Contact name">
              {[profile.firstName, profile.lastName].filter(Boolean).join(" ") || "—"}
            </Fact>
            <Fact label="Contact phone">{profile.contactPhone ?? "—"}</Fact>
            <Fact label="First MUN">{profile.munName ?? "—"}</Fact>
            <Fact label="Host city">{profile.munCity ?? "—"}</Fact>
            <Fact label="Expected start">{formatAdminDate(profile.munStartDate)}</Fact>
            <Fact label="Maximum expected delegates">{profile.expectedDelegateCount ?? "—"}</Fact>
            <Fact label="Previous editions">{profile.previousEditions ?? "—"}</Fact>
            <Fact label="Website">
              {profile.websiteUrl ? (
                <a
                  href={profile.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-link underline underline-offset-2"
                >
                  {profile.websiteUrl}
                </a>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Agreement accepted">
              {profile.completedAt ? formatAdminDateTime(profile.completedAt) : "Not yet accepted"}
            </Fact>
            {profile.munDescription && (
              <div className="col-span-full flex flex-col gap-0.5">
                <dt className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                  Description
                </dt>
                <dd className="whitespace-pre-wrap text-body-md text-ink">{profile.munDescription}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-body-md text-muted-foreground">This organizer hasn't started onboarding yet.</p>
        )}
      </Section>

      <OrganizerBankDetailsCard key={organizer.id} organizerId={organizer.id} />

      <PayoutVerificationModule
        key={organizer.id}
        organizerId={organizer.id}
        initialStatus={{
          payoutVerified: profile?.payoutVerified ?? false,
          paymentGateway: profile?.paymentGateway ?? null,
          payoutVerifiedAt: profile?.payoutVerifiedAt ?? null,
        }}
      />
    </AdminPageFrame>
  );
}
