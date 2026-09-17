import * as React from "react";
import { useNavigate } from "react-router";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductOption } from "@/components/registration/product-option";
import { StepIndicator } from "@/components/registration/step-indicator";
import type { ProductWithAvailability } from "@/components/registration/types";
import type { CommitteeWithPortfolios, FormField } from "@/types";
import { initiateRegistration } from "@/api/registration";

const STEPS = ["Option", "Details", "Review"] as const;

const controlClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
);

const textareaClassName = cn(controlClassName, "h-auto min-h-24 resize-y");

/**
 * The account already knows the delegate's name and email, and the organizer's
 * own form never asks for them — so they're collected here rather than as
 * form fields, and everything else comes from the organizer's configuration.
 */
const CORE_KEYS = ["fullName", "email", "phone"] as const;
type CoreKey = (typeof CORE_KEYS)[number];

const CORE_LABELS: Record<CoreKey, string> = {
  fullName: "Full name",
  email: "Email",
  phone: "Phone",
};

interface RegistrationFormProps {
  slug: string;
  munId: string;
  munName: string;
  products: ProductWithAvailability[];
  committees: CommitteeWithPortfolios[];
  /** The organizer's configured questions, in display order. */
  formFields: FormField[];
  /** Saved profile keyed by `fieldKey` — pre-fills matching questions. */
  profileDefaults: Record<string, string>;
  /** Name/email off the account. */
  accountDefaults: { fullName: string; email: string; phone: string };
  preselectedProductId?: string;
}

/** Single-parent conditional visibility, matching the builder's model. */
function isVisible(field: FormField, answers: Record<string, string>): boolean {
  if (!field.conditionalOn) return true;
  const parent = (answers[field.conditionalOn] ?? "").trim();
  const expected = (field.conditionalValue ?? "").trim();
  switch (field.conditionalOperator) {
    case "NOT_EQUALS":
      return parent !== expected;
    case "CONTAINS":
      return parent.toLowerCase().includes(expected.toLowerCase());
    case "EQUALS":
    default:
      return parent === expected;
  }
}

function DynamicField({
  field,
  value,
  onChange,
  showError,
}: {
  field: FormField;
  value: string;
  onChange: (next: string) => void;
  showError: boolean;
}) {
  const invalid = showError && field.required && !value.trim();
  const describedBy = field.helpText ? `${field.fieldKey}-help` : undefined;
  const choices = field.choices ?? [];
  const isChoice = choices.length > 0;
  const isLong = field.fieldType === "LONG_TEXT" || field.fieldType === "MUN_EXPERIENCE";

  const inputType =
    field.fieldType === "EMAIL"
      ? "email"
      : field.fieldType === "PHONE"
        ? "tel"
        : field.fieldType === "NUMBER"
          ? "number"
          : field.fieldType === "DATE"
            ? "date"
            : "text";

  return (
    <div className={cn("flex flex-col gap-xs", (isLong || isChoice) && "sm:col-span-2")}>
      <Label htmlFor={field.fieldKey}>
        {field.label}
        {field.required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
      </Label>

      {isChoice ? (
        <select
          id={field.fieldKey}
          className={controlClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <option value="">Select an option</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : isLong ? (
        <textarea
          id={field.fieldKey}
          className={textareaClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      ) : (
        <Input
          id={field.fieldKey}
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      )}

      {field.helpText && (
        <p id={describedBy} className="text-body-md text-muted-foreground">
          {field.helpText}
        </p>
      )}
      {invalid && (
        <p role="alert" className="text-body-md text-destructive-text">
          {field.label} is required.
        </p>
      )}
    </div>
  );
}

export function RegistrationForm({
  slug,
  munId,
  munName,
  products,
  committees,
  formFields,
  profileDefaults,
  accountDefaults,
  preselectedProductId,
}: RegistrationFormProps) {
  const navigate = useNavigate();
  const [step, setStep] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);

  // Generated once per confirm intent (spec §6.4) so a duplicate submit
  // (double click, retried request after a slow response) can't reserve two
  // seats — the server treats a replayed key as the same logical request.
  const idempotencyKeyRef = React.useRef<string | null>(null);
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();

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
  const [core, setCore] = React.useState({
    fullName: accountDefaults.fullName,
    email: accountDefaults.email,
    phone: accountDefaults.phone,
  });

  // Seeded from the saved profile so a returning delegate isn't retyping what
  // they already told us once. Still fully editable — the answers submitted
  // here are snapshotted onto the registration, not a live profile reference.
  const orderedFields = React.useMemo(
    () => [...formFields].sort((a, b) => a.displayOrder - b.displayOrder),
    [formFields],
  );
  const [answers, setAnswers] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(orderedFields.map((f) => [f.fieldKey, profileDefaults[f.fieldKey] ?? ""])),
  );

  const visibleFields = orderedFields.filter((f) => isVisible(f, answers));
  const selected = products.find((e) => e.product.id === productId);
  const selectedCommittee = committees.find((c) => c.id === committeeId);

  const detailsComplete =
    core.fullName.trim() !== "" &&
    core.email.trim() !== "" &&
    visibleFields.every((f) => !f.required || (answers[f.fieldKey] ?? "").trim() !== "");

  function handleContinueFromDetails() {
    if (!detailsComplete) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep(2);
  }

  async function handleConfirm() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const { registrationId } = await initiateRegistration(
        {
          munId,
          registrationProductId: productId,
          committeeId: committeeId || undefined,
          portfolioId: portfolioId || undefined,
          // Only visible answers: a field hidden by its conditional parent was
          // never actually asked, so submitting a stale value for it would put
          // an answer the delegate never gave in front of the organizer.
          formResponses: {
            ...core,
            ...Object.fromEntries(visibleFields.map((f) => [f.fieldKey, answers[f.fieldKey] ?? ""])),
          },
        },
        idempotencyKeyRef.current!,
      );
      navigate(`/register/${slug}/pay?registrationId=${encodeURIComponent(registrationId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reserve your seat. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-xl">
      <StepIndicator steps={STEPS} current={step} />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text"
        >
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
                      className={controlClassName}
                    >
                      <option value="">No preference</option>
                      {committees.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
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
                      className={controlClassName}
                    >
                      <option value="">
                        {selectedCommittee ? "No preference" : "Select committee first"}
                      </option>
                      {selectedCommittee?.portfolios.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
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
                <p className="text-body-md text-muted-foreground">
                  These reach the organizing team with your registration.
                  {Object.keys(profileDefaults).length > 0
                    ? " Pre-filled from your profile — edit anything that's changed."
                    : ""}
                </p>
              </div>
              <div className="grid gap-md sm:grid-cols-2">
                {CORE_KEYS.map((key) => (
                  <div key={key} className="flex flex-col gap-xs">
                    <Label htmlFor={key}>
                      {CORE_LABELS[key]}
                      {key !== "phone" && (
                        <span className="text-destructive-text" aria-hidden>
                          *
                        </span>
                      )}
                    </Label>
                    <Input
                      id={key}
                      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                      value={core[key]}
                      onChange={(e) => setCore((d) => ({ ...d, [key]: e.target.value }))}
                      aria-invalid={
                        (showErrors && key !== "phone" && !core[key].trim()) || undefined
                      }
                    />
                  </div>
                ))}

                {visibleFields.map((field) => (
                  <DynamicField
                    key={field.id}
                    field={field}
                    value={answers[field.fieldKey] ?? ""}
                    onChange={(next) =>
                      setAnswers((current) => ({ ...current, [field.fieldKey]: next }))
                    }
                    showError={showErrors}
                  />
                ))}
              </div>
              <div className="flex justify-between gap-sm">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <Button type="button" onClick={handleContinueFromDetails}>
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
                <Row label="Conference" value={munName} />
                <Row label="Pass" value={selected?.product.name ?? "—"} />
                <Row label="Committee" value={selectedCommittee?.name ?? "No preference"} />
                <Row
                  label="Portfolio"
                  value={
                    selectedCommittee?.portfolios.find((p) => p.id === portfolioId)?.name ??
                    "No preference"
                  }
                />
                <Row label="Name" value={core.fullName} />
                <Row label="Email" value={core.email} />
                {core.phone && <Row label="Phone" value={core.phone} />}
                {visibleFields.map((field) => (
                  <Row
                    key={field.id}
                    label={field.label}
                    value={(answers[field.fieldKey] ?? "").trim() || "—"}
                  />
                ))}
              </dl>
              <div className="flex justify-between gap-sm">
                <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={pending}>
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <Button type="button" onClick={handleConfirm} disabled={pending}>
                  {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
                  {pending ? "Reserving your seat…" : "Confirm and pay"}
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-md px-md py-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
