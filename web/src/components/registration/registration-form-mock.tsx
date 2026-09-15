import * as React from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrice } from "@/components/shared/currency";
import { ProductOption } from "@/components/registration/product-option";
import { StepIndicator } from "@/components/registration/step-indicator";
import type { ProductWithAvailability } from "@/components/registration/types";
import type { CommitteeWithPortfolios } from "@/types";
import { mockInitiateRegistration } from "@/mocks/registrations";

const STEPS = ["Option", "Details", "Review"] as const;
const selectClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
);

interface RegistrationFormMockProps {
  slug: string;
  munName: string;
  products: ProductWithAvailability[];
  committees: CommitteeWithPortfolios[];
  defaults: { fullName: string; email: string; phone: string; institution: string };
  preselectedProductId?: string;
}

export function RegistrationFormMock({
  slug,
  munName,
  products,
  committees,
  defaults,
  preselectedProductId,
}: RegistrationFormMockProps) {
  const navigate = useNavigate();
  const [step, setStep] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Phase 4 API wiring (§6.4): generate once per confirm-dialog intent.
  // const idempotencyKeyRef = React.useRef<string | null>(null);
  // if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
  // inject Idempotency-Key header on initiateRegistration mutation.

  const isSelectable = (entry: ProductWithAvailability) =>
    entry.available > 0 && !entry.deadlinePassed;

  const preselected = products.find(
    (e) => e.product.id === preselectedProductId && isSelectable(e),
  );
  const firstSelectable = products.find(isSelectable);

  const [productId, setProductId] = React.useState(
    preselected?.product.id ?? firstSelectable?.product.id ?? "",
  );
  const [committeeId, setCommitteeId] = React.useState("");
  const [portfolioId, setPortfolioId] = React.useState("");
  const [details, setDetails] = React.useState({
    fullName: defaults.fullName,
    email: defaults.email,
    phone: defaults.phone,
    institution: defaults.institution,
  });

  const selected = products.find((e) => e.product.id === productId);
  const selectedCommittee = committees.find((c) => c.id === committeeId);
  const detailsComplete =
    details.fullName.trim() !== "" &&
    details.email.trim() !== "" &&
    details.institution.trim() !== "";

  async function handleConfirm() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const { registrationId } = await mockInitiateRegistration({
        slug,
        registrationProductId: productId,
        committeeId: committeeId || undefined,
        portfolioId: portfolioId || undefined,
      });
      navigate(`/register/${slug}/pay?registrationId=${encodeURIComponent(registrationId)}`);
    } catch {
      setError("Could not reserve your seat. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-xl">
      <StepIndicator steps={STEPS} current={step} />

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex flex-col gap-lg">
          {step === 0 && (
            <section className="flex flex-col gap-md">
              <div>
                <h2 className="text-title-lg text-ink">Choose your registration</h2>
                <p className="text-body-md text-muted-foreground">
                  Seat counts are live — a seat is only held once you start payment.
                </p>
              </div>
              <fieldset className="flex flex-col gap-sm">
                <legend className="sr-only">Registration option</legend>
                {products.map((entry) => (
                  <ProductOption
                    key={entry.product.id}
                    entry={entry}
                    checked={productId === entry.product.id}
                    onSelect={setProductId}
                  />
                ))}
              </fieldset>
              {committees.length > 0 && (
                <div className="grid gap-sm border-t border-border pt-lg sm:grid-cols-2">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="committee-select">Committee (optional)</Label>
                    <select
                      id="committee-select"
                      value={committeeId}
                      onChange={(e) => {
                        setCommitteeId(e.target.value);
                        setPortfolioId("");
                      }}
                      className={selectClassName}
                    >
                      <option value="">No preference</option>
                      {committees.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="portfolio-select">Portfolio</Label>
                    <select
                      id="portfolio-select"
                      value={portfolioId}
                      onChange={(e) => setPortfolioId(e.target.value)}
                      disabled={!selectedCommittee}
                      className={selectClassName}
                    >
                      <option value="">{selectedCommittee ? "No preference" : "Select committee first"}</option>
                      {selectedCommittee?.portfolios.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={!selected || !isSelectable(selected)}
                >
                  Continue to details
                  <ArrowRightIcon aria-hidden />
                </Button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="flex flex-col gap-md">
              <div>
                <h2 className="text-title-lg text-ink">Delegate details</h2>
                <p className="text-body-md text-muted-foreground">These reach the organizing team with your registration.</p>
              </div>
              <div className="grid gap-md sm:grid-cols-2">
                {(["fullName", "email", "phone", "institution"] as const).map((key) => (
                  <div key={key} className="flex flex-col gap-xs">
                    <Label htmlFor={key}>{key === "fullName" ? "Full name" : key === "institution" ? "School or university" : key.charAt(0).toUpperCase() + key.slice(1)}</Label>
                    <Input
                      id={key}
                      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                      value={details[key]}
                      onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
                      required={key !== "phone"}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-sm">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <Button type="button" onClick={() => setStep(2)} disabled={!detailsComplete}>
                  Review
                  <ArrowRightIcon aria-hidden />
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="flex flex-col gap-md">
              <div>
                <h2 className="text-title-lg text-ink">Review and confirm</h2>
                <p className="text-body-md text-muted-foreground">
                  Confirming reserves a seat for 15 minutes while you complete payment.
                </p>
              </div>
              <dl className="divide-y divide-border rounded-md border border-border text-body-md">
                <Row label="Pass" value={selected?.product.name ?? "—"} />
                <Row label="Name" value={details.fullName} />
                <Row label="Email" value={details.email} />
                <Row label="Institution" value={details.institution} />
              </dl>
              <div className="flex justify-between gap-sm">
                <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={pending}>
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <Button type="button" onClick={handleConfirm} disabled={pending}>
                  {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
                  {pending ? "Reserving…" : "Confirm and pay"}
                </Button>
              </div>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-md rounded-md bg-surface-soft p-lg lg:sticky lg:top-lg">
          <p className="text-caption uppercase text-muted-foreground">Your registration</p>
          <p className="text-title-sm text-ink">{munName}</p>
          <div className="flex items-baseline justify-between border-t border-border pt-md">
            <span className="text-label-md text-ink">Total</span>
            <span className="font-mono text-title-sm tabular-nums text-ink">
              {selected ? formatPrice(selected.product.price) : "—"}
            </span>
          </div>
          <Link to={`/mun/${slug}`} className="inline-flex items-center gap-xs text-body-md text-link hover:underline">
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            Back to conference
          </Link>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-md px-md py-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
