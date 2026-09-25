import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getOrganizerBankDetails } from "@/api/organizer-admin";
import { Button } from "@/components/ui/button";
import type { OrganizerBankDetails } from "@/types/organizer-admin";

/**
 * Reveal-on-click payout bank details, shared by the Gate-1 review dialog
 * (review-page.tsx) and the admin organizer detail page. Extracted from
 * review-page.tsx's original inline block (2026-09-26) — same discipline
 * either place: local component state, never a `useQuery`, never cached
 * under a persistent query key, and cleared whenever the surrounding
 * dialog/page unmounts (nothing to do here — state simply resets with the
 * component). Every reveal is audit-logged server-side
 * (`lib/actions/organizer-admin.ts#getOrganizerBankDetails`).
 */
export function OrganizerBankDetailsCard({ organizerId }: { organizerId: string }) {
  const [bankDetails, setBankDetails] = useState<OrganizerBankDetails | null>(null);

  const revealMutation = useMutation({
    mutationFn: () => getOrganizerBankDetails(organizerId),
    onSuccess: setBankDetails,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to load bank details"),
  });

  return (
    <div className="flex flex-col gap-sm rounded-md border border-warning/40 bg-warning/5 p-md text-body-md">
      <div className="flex items-center justify-between gap-sm">
        <span className="font-medium text-ink">Payout bank details</span>
        {!bankDetails && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => revealMutation.mutate()}
            disabled={revealMutation.isPending}
          >
            {revealMutation.isPending ? "Revealing…" : "Reveal bank details"}
          </Button>
        )}
      </div>
      {bankDetails ? (
        bankDetails.bankAccountNumber ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-xxs">
            <dt className="text-muted-foreground">Account holder</dt>
            <dd>{bankDetails.accountHolderName}</dd>
            <dt className="text-muted-foreground">Bank</dt>
            <dd>{bankDetails.bankName}</dd>
            <dt className="text-muted-foreground">Account number</dt>
            <dd className="font-mono tabular-nums">{bankDetails.bankAccountNumber}</dd>
            <dt className="text-muted-foreground">IFSC</dt>
            <dd className="font-mono">{bankDetails.ifscCode}</dd>
            {bankDetails.upiId && (
              <>
                <dt className="text-muted-foreground">UPI ID (optional)</dt>
                <dd>
                  {bankDetails.upiId} · {bankDetails.upiPhone}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground">This organizer hasn't entered bank payout details yet.</p>
        )
      ) : (
        <p className="text-muted-foreground">
          Only reveal this to set the organizer up as a payout beneficiary in the payment gateway — every reveal is
          recorded in the audit log.
        </p>
      )}
    </div>
  );
}
