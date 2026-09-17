import * as React from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductOption } from "@/components/registration/product-option";
import { currentPassPrice } from "@/components/registration/pricing";
import { RegistrationSummary } from "@/components/registration/registration-summary";
import { StepIndicator } from "@/components/registration/step-indicator";
import { formatPrice } from "@/components/shared/currency";
import type { ProductWithAvailability } from "@/components/registration/types";
import type { CommitteeWithPortfolios, FormField } from "@/types";
import type { PublicAccommodationOption } from "@/types/public-mun";
import type { AccommodationOptionField } from "@/types/accommodation";
import { listAccommodationOptionFields } from "@/api/accommodation";
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
  /** Stays sold with the pass, charged in the same payment. Empty when none. */
  accommodationOptions: PublicAccommodationOption[];
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
  accommodationOptions,
  profileDefaults,
  accountDefaults,
  preselectedProductId,
}: RegistrationFormProps) {
  const navigate = useNavigate();
  const [step, setStep] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  // Each step starts at its own heading: without this, continuing from a
  // long details step left the next step scrolled halfway down, and keyboard
  // focus on a button that no longer exists.
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const movedStep = React.useRef(false);
  const errorRef = React.useRef<HTMLDivElement>(null);

  function goToStep(next: number) {
    movedStep.current = true;
    setStep(next);
  }

  React.useEffect(() => {
    if (!movedStep.current) return;
    movedStep.current = false;
    stepHeadingRef.current?.focus({ preventScroll: true });
    stepHeadingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step]);

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

  // "" = arranging their own stay. Never pre-selected: a paid add-on has to
  // be chosen deliberately.
  const [accommodationOptionId, setAccommodationOptionId] = React.useState("");
  const [stayAnswers, setStayAnswers] = React.useState<Record<string, string>>({});
  const selectedStay = accommodationOptions.find((option) => option.id === accommodationOptionId);

  // The organizer's questions for the chosen stay (arrival date, room-mate…),
  // answered under the same registration and keyed by field id.
  const stayFieldsQuery = useQuery({
    queryKey: ["accommodation-fields", accommodationOptionId],
    queryFn: () => listAccommodationOptionFields(accommodationOptionId),
    enabled: accommodationOptionId !== "",
  });
  const stayFields: AccommodationOptionField[] = React.useMemo(
    () => [...(stayFieldsQuery.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [stayFieldsQuery.data],
  );

  const visibleFields = orderedFields.filter((f) => isVisible(f, answers));
  const selected = products.find((e) => e.product.id === productId);
  const selectedCommittee = committees.find((c) => c.id === committeeId);
  const selectedPricing = selected ? currentPassPrice(selected.product) : null;
  const passPrice = selectedPricing?.price ?? 0;
  const stayPrice = selectedStay?.price ?? 0;
  const total = passPrice + stayPrice;
  const free = total === 0;

  const detailsComplete =
    core.fullName.trim() !== "" &&
    core.email.trim() !== "" &&
    visibleFields.every((f) => !f.required || (answers[f.fieldKey] ?? "").trim() !== "") &&
    stayFields.every((f) => !f.required || (stayAnswers[f.id] ?? "").trim() !== "");

  function handleContinueFromDetails() {
    if (!detailsComplete) {
      setShowErrors(true);
      // Land on the first thing that still needs an answer rather than
      // leaving the delegate to hunt for the red border.
      const firstMissing =
        (core.fullName.trim() === "" && "fullName") ||
        (core.email.trim() === "" && "email") ||
        visibleFields.find((f) => f.required && !(answers[f.fieldKey] ?? "").trim())?.fieldKey ||
        `stay-${stayFields.find((f) => f.required && !(stayAnswers[f.id] ?? "").trim())?.id ?? ""}`;
      const element = typeof firstMissing === "string" ? document.getElementById(firstMissing) : null;
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setShowErrors(false);
    goToStep(2);
  }

  async function handleConfirm() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const { registrationId, status } = await initiateRegistration(
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
          accommodationOptionId: accommodationOptionId || undefined,
          // Keyed by field id, the shape the organizer's roster reads back
          // (lib/actions/organizer-dashboard.ts#loadAccommodation).
          accommodationAnswers: accommodationOptionId
            ? Object.fromEntries(stayFields.map((f) => [f.id, stayAnswers[f.id] ?? ""]))
            : undefined,
        },
        idempotencyKeyRef.current!,
      );
      // A free pass comes back already confirmed — there is nothing to pay.
      const next = status === "CONFIRMED" ? "confirmation" : "pay";
      navigate(`/register/${slug}/${next}?registrationId=${encodeURIComponent(registrationId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reserve your seat. Try again.");
      setPending(false);
      // The message sits with the button that failed, and gets focus: it used
      // to render at the top of the page, off-screen from the confirm button.
      window.requestAnimationFrame(() => {
        errorRef.current?.focus({ preventScroll: true });
        errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }

  return (
    <div className="flex flex-col gap-xl">
      <StepIndicator steps={STEPS} current={step} />

      <div className="grid grid-cols-1 gap-xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex flex-col gap-lg">
          {step === 0 && (
            <section className="flex flex-col gap-md">
              <div>
                <h2 ref={stepHeadingRef} tabIndex={-1} className="text-title-lg text-ink outline-none">
                  Choose your registration
                </h2>
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
              {accommodationOptions.length > 0 && (
                <fieldset className="flex flex-col gap-sm border-t border-border pt-lg">
                  <legend className="text-label-md text-ink">Accommodation</legend>
                  <p className="text-body-md text-muted-foreground">
                    Optional — a stay is charged together with your pass.
                  </p>
                  <StayOption
                    name="I'll arrange my own stay"
                    price={null}
                    checked={accommodationOptionId === ""}
                    onSelect={() => setAccommodationOptionId("")}
                  />
                  {accommodationOptions.map((option) => (
                    <StayOption
                      key={option.id}
                      name={option.name}
                      description={option.description}
                      price={option.price}
                      checked={accommodationOptionId === option.id}
                      onSelect={() => {
                        setAccommodationOptionId(option.id);
                        setStayAnswers({});
                      }}
                    />
                  ))}
                </fieldset>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => goToStep(1)}
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
                <h2 ref={stepHeadingRef} tabIndex={-1} className="text-title-lg text-ink outline-none">
                  Delegate details
                </h2>
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
                      aria-describedby={
                        showErrors && key !== "phone" && !core[key].trim() ? `${key}-error` : undefined
                      }
                    />
                    {showErrors && key !== "phone" && !core[key].trim() && (
                      <p id={`${key}-error`} className="text-body-md text-destructive-text">
                        {CORE_LABELS[key]} is required.
                      </p>
                    )}
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

              {selectedStay && stayFields.length > 0 && (
                <div className="flex flex-col gap-md border-t border-border pt-lg">
                  <div>
                    <h3 className="text-label-md text-ink">Your stay: {selectedStay.name}</h3>
                    <p className="text-body-md text-muted-foreground">
                      The organizers ask this about the accommodation you picked.
                    </p>
                  </div>
                  <div className="grid gap-md sm:grid-cols-2">
                    {stayFields.map((field) => (
                      <StayField
                        key={field.id}
                        field={field}
                        value={stayAnswers[field.id] ?? ""}
                        onChange={(next) =>
                          setStayAnswers((current) => ({ ...current, [field.id]: next }))
                        }
                        showError={showErrors}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between gap-sm">
                <Button type="button" variant="outline" onClick={() => goToStep(0)}>
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
                <h2 ref={stepHeadingRef} tabIndex={-1} className="text-title-lg text-ink outline-none">
                  Review and confirm
                </h2>
                <p className="text-body-md text-muted-foreground">
                  {free ? (
                    "This pass is free — confirming books your seat straight away."
                  ) : (
                    <>
                      Confirming reserves a seat for 15 minutes while you complete payment.{" "}
                      <Link to="/legal/refunds" className="text-link underline-offset-4 hover:underline">
                        All payments are final
                      </Link>
                      .
                    </>
                  )}
                </p>
              </div>
              <dl className="divide-y divide-border rounded-md border border-border text-body-md">
                <Row label="Conference" value={munName} />
                <Row label="Pass" value={selected?.product.name ?? "—"} />
                {selectedPricing && (
                  <Row
                    label="Price"
                    value={
                      selectedPricing.earlyBird
                        ? `${formatPrice(selectedPricing.price)} (early bird)`
                        : free
                          ? "Free"
                          : formatPrice(selectedPricing.price)
                    }
                  />
                )}
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
                {accommodationOptions.length > 0 && (
                  <Row
                    label="Stay"
                    value={
                      selectedStay
                        ? `${selectedStay.name} · ${formatPrice(selectedStay.price)}`
                        : "Arranging my own"
                    }
                  />
                )}
                {selectedStay && stayFields.map((field) => (
                  <Row
                    key={field.id}
                    label={field.label}
                    value={(stayAnswers[field.id] ?? "").trim() || "—"}
                  />
                ))}
                {selectedStay && (
                  <Row label="Total" value={free ? "Free" : formatPrice(total)} strong />
                )}
              </dl>

              {error && (
                <div
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="flex flex-col gap-xs rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text outline-none"
                >
                  <p>{error}</p>
                  {/verify your email/i.test(error) ? (
                    <p className="text-body">
                      <Link to="/verify-email" className="font-medium underline underline-offset-2">
                        Send me a new verification link
                      </Link>{" "}
                      — open it, then come back and confirm again.
                    </p>
                  ) : /profile/i.test(error) ? (
                    <p className="text-body">
                      <Link to="/profile" className="font-medium underline underline-offset-2">
                        Go to your profile
                      </Link>
                    </p>
                  ) : null}
                </div>
              )}

              <div className="flex justify-between gap-sm">
                <Button type="button" variant="outline" onClick={() => goToStep(1)} disabled={pending}>
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <Button type="button" onClick={handleConfirm} disabled={pending}>
                  {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
                  {pending ? "Reserving your seat…" : free ? "Confirm registration" : "Confirm and pay"}
                </Button>
              </div>
            </section>
          )}
        </div>

        {/* Running order summary. Not on the review step, which already lists
            everything in full — two copies of the same answers read as a bug. */}
        {step < 2 && (
          <RegistrationSummary
            munName={munName}
            slug={slug}
            selected={selected}
            passPrice={passPrice}
            committeeName={selectedCommittee?.name}
            portfolioName={selectedCommittee?.portfolios.find((p) => p.id === portfolioId)?.name}
            accommodation={selectedStay ? { name: selectedStay.name, price: selectedStay.price } : undefined}
            showAccommodationRow={accommodationOptions.length > 0}
            total={total}
          />
        )}
      </div>
    </div>
  );
}

/** A selectable stay, styled like `ProductOption` so the two read as one set. */
function StayOption({
  name,
  description,
  price,
  checked,
  onSelect,
}: {
  name: string;
  description?: string | null;
  /** `null` for the "own arrangements" choice, which costs nothing. */
  price: number | null;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "group relative flex cursor-pointer items-start gap-md rounded-md border p-md transition-colors",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        checked ? "border-ink bg-surface-soft" : "border-border bg-card hover:bg-surface-soft",
      )}
    >
      <input
        type="radio"
        name="accommodation-option"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked ? "border-ink" : "border-border-strong",
        )}
      >
        <span
          className={cn(
            "size-2.5 rounded-full transition-transform",
            checked ? "scale-100 bg-ink" : "scale-0 bg-transparent",
          )}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-xxs">
        <span className="flex flex-wrap items-baseline justify-between gap-xs">
          <span className="text-label-md text-ink">{name}</span>
          {price !== null && (
            <span className="font-mono text-label-md tabular-nums text-ink">{formatPrice(price)}</span>
          )}
        </span>
        {description && <span className="text-body-md text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

/** One organizer question about the chosen stay. */
function StayField({
  field,
  value,
  onChange,
  showError,
}: {
  field: AccommodationOptionField;
  value: string;
  onChange: (next: string) => void;
  showError: boolean;
}) {
  const invalid = showError && field.required && !value.trim();
  const id = `stay-${field.id}`;
  const choices = field.choices ?? [];

  return (
    <div className={cn("flex flex-col gap-xs", choices.length > 0 && "sm:col-span-2")}>
      <Label htmlFor={id}>
        {field.label}
        {field.required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
      </Label>
      {choices.length > 0 ? (
        <select
          id={id}
          className={controlClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
        >
          <option value="">Select an option</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : field.fieldType === "CHECKBOX" ? (
        <label className="flex items-center gap-sm text-body-md text-body">
          <input
            id={id}
            type="checkbox"
            checked={value === "Yes"}
            onChange={(event) => onChange(event.target.checked ? "Yes" : "No")}
            className="size-5 rounded-sm border-input"
          />
          Yes
        </label>
      ) : (
        <Input
          id={id}
          type={field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
        />
      )}
      {invalid && (
        <p role="alert" className="text-body-md text-destructive-text">
          {field.label} is required.
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-md px-md py-sm">
      <dt className={cn("text-muted-foreground", strong && "font-medium text-ink")}>{label}</dt>
      <dd className={cn("text-right text-ink", strong && "font-medium")}>{value}</dd>
    </div>
  );
}
