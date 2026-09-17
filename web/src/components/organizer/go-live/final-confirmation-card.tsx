import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, PencilIcon } from "lucide-react";
import { getConfirmationPreview } from "@/api/go-live";
import { queryKeys } from "@/api/query-keys";
import { formatPrice } from "@/components/shared/currency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConfirmationPreview } from "@/types/go-live";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(iso: string | null, formatter = dateFormatter): string {
  return iso ? formatter.format(new Date(iso)) : "Not set";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Gate 3: the organizer reviews a summary of everything they're submitting and
 * attests to it before MUN Hub's verification starts.
 */
export function FinalConfirmationCard({
  munId,
  confirming,
  onConfirm,
  withdrawing,
  onWithdraw,
}: {
  munId: string;
  confirming: boolean;
  onConfirm: () => void;
  withdrawing: boolean;
  /** "Make changes first": unlock the sections to fix something before confirming. */
  onWithdraw: () => void;
}) {
  const [attested, setAttested] = useState(false);
  const attestationId = useId();
  const previewQuery = useQuery({
    queryKey: queryKeys.munConfirmationPreview(munId),
    queryFn: () => getConfirmationPreview(munId),
  });

  return (
    <Card aria-labelledby="final-confirmation-title" className="border-primary/40">
      <CardHeader>
        <CardTitle>
          <h2 id="final-confirmation-title" className="text-title-sm">Confirm your submission</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        <p className="text-body-md text-muted-foreground">
          Your MUN passed the automated checks. Review this summary, then confirm to send it to MUN Hub for
          verification. Your sections are locked meanwhile; if something needs fixing, choose Make changes first.
        </p>
        {previewQuery.isLoading && <Skeleton className="h-40 w-full rounded-md" />}
        {previewQuery.isError && <p className="text-body-md text-destructive">{previewQuery.error.message}</p>}
        {previewQuery.data && (
          <>
            <ConfirmationSummary preview={previewQuery.data} />
            <div className="flex items-start gap-sm rounded-sm border border-border bg-surface-soft p-sm">
              <Checkbox
                id={attestationId}
                checked={attested}
                onCheckedChange={(checked) => setAttested(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor={attestationId} className="text-body-md text-ink">
                {previewQuery.data.attestation}
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-xs">
              <Button size="sm" variant="outline" disabled={withdrawing || confirming} onClick={onWithdraw}>
                <PencilIcon aria-hidden />
                {withdrawing ? "Unlocking..." : "Make changes first"}
              </Button>
              <Button size="sm" disabled={!attested || confirming || withdrawing} onClick={onConfirm}>
                <CheckCircle2Icon aria-hidden />
                {confirming ? "Confirming..." : "Confirm & send for verification"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmationSummary({ preview }: { preview: ConfirmationPreview }) {
  const { snapshot } = preview;
  const mun = snapshot.mun;
  const hasLogo = snapshot.media.some((item) => item.kind === "LOGO");
  const hasCover = snapshot.media.some((item) => item.kind === "COVER");
  const payment = snapshot.paymentSettings;
  const place = [mun?.venue, mun?.city, mun?.country].filter(Boolean).join(", ");

  const rows: { label: string; value: string }[] = [
    { label: "Conference", value: mun ? [mun.name, mun.edition].filter(Boolean).join(" · ") : "Not set" },
    {
      label: "Dates",
      value: mun?.startDate ? `${formatDate(mun.startDate)} – ${formatDate(mun.endDate)}` : "Not set",
    },
    { label: "Venue", value: place || "Not set" },
    {
      label: "Registration",
      value: `Opens ${formatDate(mun?.registrationOpensAt ?? null, dateTimeFormatter)}, closes ${formatDate(mun?.registrationDeadline ?? null, dateTimeFormatter)}`,
    },
    {
      label: "Committees",
      value: `${plural(snapshot.committees.length, "committee")}, ${plural(snapshot.portfolios.length, "portfolio")}`,
    },
    { label: "Executive board", value: plural(snapshot.executiveBoard.length, "member") },
    {
      label: "Registration products",
      value:
        snapshot.registrationProducts.length === 0
          ? "None"
          : snapshot.registrationProducts
              .map((product) => `${product.name} (${formatPrice(product.price)}, ${product.capacity} seats)`)
              .join("; "),
    },
    { label: "Registration form", value: plural(snapshot.formFields.length, "custom question") },
    {
      label: "Payouts",
      value: payment
        ? [payment.accountHolderName, payment.bankName, payment.accountNumberLast4 && `•••• ${payment.accountNumberLast4}`]
            .filter(Boolean)
            .join(" · ")
        : "Not set",
    },
    { label: "Branding", value: `${hasLogo ? "Logo" : "No logo"}, ${hasCover ? "cover image" : "no cover image"}` },
    {
      label: "Documents",
      value: snapshot.documents.length === 0 ? "None" : snapshot.documents.map((doc) => doc.title).join(", "),
    },
    { label: "Schedule", value: plural(snapshot.scheduleItems.length, "item") },
    {
      label: "Contact",
      value: [snapshot.contact?.officialEmail, snapshot.contact?.phone].filter(Boolean).join(" · ") || "Not set",
    },
    {
      label: "Accommodation",
      value:
        mun?.accommodationProvided === "PROVIDED"
          ? plural(snapshot.accommodationOptions.length, "option")
          : mun?.accommodationProvided === "NOT_PROVIDED"
            ? "Not provided"
            : "Not answered",
    },
  ];

  return (
    <dl className="grid gap-x-md gap-y-xs text-body-md sm:grid-cols-[11rem_minmax(0,1fr)]" data-testid="confirmation-summary">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
