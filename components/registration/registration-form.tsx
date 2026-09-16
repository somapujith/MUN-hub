"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, Loader2Icon, LockIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrice } from "@/components/shared/currency";
import { ProductOption } from "@/components/registration/product-option";
import { RegistrationSummary } from "@/components/registration/registration-summary";
import { StepIndicator } from "@/components/registration/step-indicator";
import { AccommodationStep } from "@/components/registration/accommodation-step";
import {
  emptyValueFor,
  serializeFieldValues,
  validateFieldValues,
  type FieldValue,
} from "@/components/registration/accommodation-fields";
import {
  loadAccommodationFieldsAction,
  submitRegistrationAction,
  type RegisterFormState,
} from "@/app/register/[slug]/actions";
import type {
  AccommodationOption,
  AccommodationOptionField,
} from "@/lib/actions/accommodation";
import type { CommitteeWithPortfolios, RegistrationFormField, RegistrationProduct } from "@/lib/types";

/** A product joined to its live seat count, computed server-side. */
export interface ProductWithAvailability {
  product: RegistrationProduct;
  capacity: number;
  taken: number;
  available: number;
  /**
   * Evaluated on the server. Deliberately not derived from `Date.now()` in the
   * client render — that is impure and makes the server and client disagree at
   * hydration whenever a deadline falls between the two renders.
   */
  deadlinePassed: boolean;
}

interface RegistrationFormProps {
  slug: string;
  munName: string;
  products: ProductWithAvailability[];
  committees: CommitteeWithPortfolios[];
  /**
   * Active accommodation options for this MUN, resolved server-side. An empty
   * array removes the accommodation step entirely rather than showing a step
   * whose only choice is "no".
   */
  accommodationOptions: AccommodationOption[];
  formFields: RegistrationFormField[];
  /** Prefill from the signed-in user's profile — editable, never authoritative. */
  defaults: {
    fullName: string;
    email: string;
    phone: string;
    institution: string;
    /**
     * Sourced from the student's saved profile (`mun_experience`). Pre-fills
     * the hardcoded "Prior MUN experience" field so a returning student isn't
     * asked twice.
     */
    experience?: string;
  };
  /**
   * The student's saved onboarding profile, keyed by the same `fieldKey`s as
   * `DEFAULT_REGISTRATION_FIELDS` (grade_class, residential_address,
   * transportation, date_of_birth, referral_code, emergency_contact_name,
   * emergency_contact_phone, mun_experience). Used to pre-fill this mun's own
   * `formFields` when a field's `fieldKey` matches a known profile key — the
   * per-mun form stays fully editable and authoritative; this is pre-fill
   * only, never a bypass of the organizer's required/optional configuration.
   */
  profileDefaults: Record<string, string>;
  /** Product deep-linked from the MUN page, already validated server-side. */
  preselectedProductId?: string;
}

/**
 * STEP ORDER: Option -> Details -> Accommodation -> Review.
 *
 * Accommodation sits AFTER Details, not beside the pass picker, for two
 * reasons. (1) Step 0 already carries the pass radio group plus committee and
 * portfolio selects; bolting a second priced radio group onto it makes the
 * first screen the heaviest in the funnel and buries the committee controls.
 * (2) Accommodation's custom fields are logistics questions (arrival date,
 * roommate, room sharing) that read as a natural follow-on once the delegate
 * has already identified themselves — and this way the running total in the
 * summary grows monotonically, pass then room, ending at Review.
 *
 * The step list is derived, not constant: a MUN with no accommodation
 * inventory renders the original three-step funnel byte-for-byte.
 */
const BASE_STEPS = ["Option", "Details", "Review"] as const;
const ACCOMMODATION_STEPS = ["Option", "Details", "Accommodation", "Review"] as const;

/** Named so the two shapes never get compared by raw index. */
const STEP_OPTION = 0;
const STEP_DETAILS = 1;

const initialState: RegisterFormState = { status: "idle" };

export function RegistrationForm({
  slug,
  munName,
  products,
  committees,
  accommodationOptions,
  formFields,
  defaults,
  profileDefaults,
  preselectedProductId,
}: RegistrationFormProps) {
  const [state, formAction] = useActionState(submitRegistrationAction, initialState);

  const hasAccommodation = accommodationOptions.length > 0;
  const steps = hasAccommodation ? ACCOMMODATION_STEPS : BASE_STEPS;
  const stepAccommodation = hasAccommodation ? 2 : -1;
  const stepReview = hasAccommodation ? 3 : 2;

  const [step, setStep] = React.useState(STEP_OPTION);

  // Prefer the deep-linked product, but only if it's actually purchasable —
  // otherwise fall back to the first option the user could really buy.
  const isSelectable = (entry: ProductWithAvailability) =>
    entry.available > 0 && !entry.deadlinePassed;

  const preselected = products.find(
    (entry) => entry.product.id === preselectedProductId && isSelectable(entry),
  );
  const firstSelectable = products.find(isSelectable);
  const [productId, setProductId] = React.useState<string>(
    preselected?.product.id ?? firstSelectable?.product.id ?? "",
  );
  const [committeeId, setCommitteeId] = React.useState<string>("");
  const [portfolioId, setPortfolioId] = React.useState<string>("");

  const [details, setDetails] = React.useState({
    fullName: defaults.fullName,
    email: defaults.email,
    phone: defaults.phone,
    institution: defaults.institution,
    experience: defaults.experience ?? "",
    dietary: "",
    accommodations: "",
  });
  const configurableFields = formFields.filter(
    (field) => !["institution_name", "mun_experience"].includes(field.fieldKey),
  );
  const [customFieldValues, setCustomFieldValues] = React.useState<Record<string, string>>(
    () => ({ ...profileDefaults }),
  );

  // ---- Accommodation state ------------------------------------------------
  // `""` is the "No accommodation" sentinel and the default: a student who
  // never touches this step submits with no option id and no answers, and the
  // server never enters its accommodation branch.
  const [accommodationOptionId, setAccommodationOptionId] = React.useState("");
  const [accommodationFields, setAccommodationFields] = React.useState<
    AccommodationOptionField[]
  >([]);
  const [loadingFields, setLoadingFields] = React.useState(false);
  const [fieldsError, setFieldsError] = React.useState<string | null>(null);
  const [fieldValues, setFieldValues] = React.useState<Record<string, FieldValue>>({});
  const [showFieldErrors, setShowFieldErrors] = React.useState(false);
  // Bumped to force a refetch after a failed load without changing the option.
  const [fieldsFetchNonce, setFieldsFetchNonce] = React.useState(0);

  const selectedAccommodation = accommodationOptions.find(
    (option) => option.id === accommodationOptionId,
  );

  /**
   * Fetch the selected option's field definitions on selection.
   *
   * Deliberately not prefetched for every option at page load — a conference
   * can publish many room types with many questions each and the student fills
   * in exactly one set.
   *
   * The `stale` guard matters: options can be clicked faster than the round
   * trip resolves, and without it a slow response for option A can land after
   * a fast one for option B and repaint B's form with A's fields.
   */
  React.useEffect(() => {
    if (!accommodationOptionId) {
      setAccommodationFields([]);
      setLoadingFields(false);
      setFieldsError(null);
      return;
    }

    let stale = false;
    setLoadingFields(true);
    setFieldsError(null);

    loadAccommodationFieldsAction(slug, accommodationOptionId)
      .then((fields) => {
        if (stale) return;
        setAccommodationFields(fields);
        // Seed every field to its empty value up front. The inputs are
        // controlled, so a missing key would make React flip them from
        // uncontrolled to controlled on first keystroke — the same class of
        // bug as a mutating `defaultValue`, which this form has already been
        // bitten by once.
        setFieldValues(
          Object.fromEntries(fields.map((field) => [field.id, emptyValueFor(field)])),
        );
        setLoadingFields(false);
      })
      .catch(() => {
        if (stale) return;
        setAccommodationFields([]);
        setFieldsError("We couldn't load the questions for this option.");
        setLoadingFields(false);
      });

    return () => {
      stale = true;
    };
  }, [slug, accommodationOptionId, fieldsFetchNonce]);

  // Switching option invalidates the previous option's answers entirely —
  // field ids don't carry across options, so keeping them would smuggle stale
  // keys into the submitted blob.
  const handleAccommodationChange = (nextOptionId: string) => {
    setAccommodationOptionId(nextOptionId);
    setFieldValues({});
    setShowFieldErrors(false);
  };

  const accommodationErrors = selectedAccommodation
    ? validateFieldValues(accommodationFields, fieldValues)
    : [];

  // A student on the skip path is never blocked. Neither is one whose fields
  // are still in flight or failed to load — but they can't advance either,
  // because we'd be submitting answers we never validated.
  const accommodationBlocked = Boolean(
    selectedAccommodation && (loadingFields || fieldsError || accommodationErrors.length > 0),
  );

  const handleAccommodationNext = () => {
    if (accommodationErrors.length > 0) {
      setShowFieldErrors(true);
      return;
    }
    setStep(stepReview);
  };

  const selected = products.find((entry) => entry.product.id === productId);
  const selectedCommittee = committees.find((committee) => committee.id === committeeId);

  const totalPrice = (selected?.product.price ?? 0) + (selectedAccommodation?.price ?? 0);

  // A committee change invalidates any portfolio picked under the old one.
  const handleCommitteeChange = (nextCommitteeId: string) => {
    setCommitteeId(nextCommitteeId);
    setPortfolioId("");
  };

  const detailsComplete =
    details.fullName.trim() !== "" &&
    details.email.trim() !== "" &&
    details.institution.trim() !== "" &&
    configurableFields.every((field) => !field.required || customFieldValues[field.fieldKey]?.trim());

  // A server-reported failure has to move the user back to the step that owns
  // the problem: a sold-out seat belongs to the option picker, a rejected field
  // to the details form.
  //
  // This is derived during render rather than synced in an effect. The
  // `useActionState` result is the source of truth, and each new result object
  // is a fresh identity, so comparing it against the last one we reacted to
  // gives us "a new server error arrived" without a cascading re-render.
  //
  // "accommodation" resolves to the accommodation step when it exists; if it
  // doesn't, there is no step that owns the problem, so we leave the user
  // where they are and let the alert carry the message.
  const serverErrorStep: number | null =
    state.reason === "capacity"
      ? STEP_OPTION
      : state.reason === "validation"
        ? STEP_DETAILS
        : state.reason === "accommodation" && hasAccommodation
          ? stepAccommodation
          : null;

  const [handledState, setHandledState] = React.useState<RegisterFormState>(initialState);
  const alertRef = React.useRef<HTMLDivElement>(null);
  let activeStep = step;
  if (state !== handledState) {
    setHandledState(state);
    if (serverErrorStep !== null) {
      activeStep = serverErrorStep;
      setStep(serverErrorStep);
    }
  }

  // Move focus to the error alert whenever a new server error lands — without
  // this, a screen reader/keyboard user gets no signal that the step just
  // changed out from under them (WCAG 2.4.3, 4.1.3).
  React.useEffect(() => {
    if (state.status === "error" && state.message) {
      alertRef.current?.focus();
    }
    // Only when the state identity actually changes (a fresh server response),
    // not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-xl">
      {/* Every value the server needs travels as a hidden field so the action
          works identically whether the user clicked through the steps or the
          form was submitted without JS re-rendering the intermediate steps. */}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="registrationProductId" value={productId} />
      <input type="hidden" name="committeeId" value={committeeId} />
      <input type="hidden" name="portfolioId" value={portfolioId} />
      {/* Empty string = skip path. The server treats "" as "no accommodation"
          and never touches the accommodation branch. */}
      <input type="hidden" name="accommodationOptionId" value={accommodationOptionId} />
      <input
        type="hidden"
        name="accommodationFieldValues"
        value={
          accommodationOptionId ? serializeFieldValues(fieldValues) : ""
        }
      />
      {activeStep !== STEP_DETAILS && (
        <>
          <input type="hidden" name="fullName" value={details.fullName} />
          <input type="hidden" name="email" value={details.email} />
          <input type="hidden" name="phone" value={details.phone} />
          <input type="hidden" name="institution" value={details.institution} />
          <input type="hidden" name="experience" value={details.experience} />
          <input type="hidden" name="dietary" value={details.dietary} />
          <input type="hidden" name="accommodations" value={details.accommodations} />
              <input type="hidden" name="customFieldValues" value={JSON.stringify(customFieldValues)} />
        </>
      )}

      <StepIndicator steps={steps} current={activeStep} />

      {state.status === "error" && state.message && (
        <div
          ref={alertRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          className="rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text outline-none"
        >
          {state.message}
          {state.reason === "capacity" && (
            <span className="mt-xxs block">
              Pick another option below, or{" "}
              <Link href={`/mun/${slug}`} className="text-link underline underline-offset-4">
                return to {munName}
              </Link>
              .
            </span>
          )}
          {state.reason === "profile" && (
            <span className="mt-xxs block">
              <Link
                href={`/profile?redirectTo=${encodeURIComponent(`/register/${slug}`)}`}
                className="text-link underline underline-offset-4"
              >
                Complete your profile
              </Link>
              , then come back to finish registering.
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex flex-col gap-lg">
          {activeStep === STEP_OPTION && (
            <StepPanel
              title="Choose your registration"
              description="Pick the pass you want. Seat counts are live — a seat is only held once you start payment."
            >
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
                <div className="flex flex-col gap-sm border-t border-border pt-lg">
                  <div className="flex flex-col gap-xxs">
                    <h3 className="text-title-sm text-ink">Committee preference</h3>
                    <p className="text-body-md text-muted-foreground">
                      Optional. Organizers use this as a preference, not a guarantee.
                    </p>
                  </div>

                  <div className="grid gap-sm sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="committee-select">Committee</Label>
                      <select
                        id="committee-select"
                        value={committeeId}
                        onChange={(event) => handleCommitteeChange(event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">No preference</option>
                        {committees.map((committee) => (
                          <option key={committee.id} value={committee.id}>
                            {committee.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="portfolio-select">Portfolio</Label>
                      <select
                        id="portfolio-select"
                        value={portfolioId}
                        onChange={(event) => setPortfolioId(event.target.value)}
                        disabled={!selectedCommittee}
                        className={selectClassName}
                      >
                        <option value="">
                          {selectedCommittee ? "No preference" : "Select a committee first"}
                        </option>
                        {selectedCommittee?.portfolios.map((portfolio) => (
                          <option key={portfolio.id} value={portfolio.id}>
                            {portfolio.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selectedCommittee?.agenda && (
                    <p className="rounded-sm bg-surface-soft px-sm py-xs text-body-md text-muted-foreground">
                      {selectedCommittee.agenda}
                    </p>
                  )}
                </div>
              )}

              <StepNav
                onNext={() => setStep(STEP_DETAILS)}
                nextDisabled={!selected || !isSelectable(selected)}
                nextLabel="Continue to details"
              />
            </StepPanel>
          )}

          {activeStep === STEP_DETAILS && (
            <StepPanel
              title="Delegate details"
              description="These reach the organizing team with your registration."
            >
              <div className="grid gap-md sm:grid-cols-2">
                <Field
                  id="fullName"
                  label="Full name"
                  required
                  invalid={serverErrorStep === 1 && !details.fullName.trim()}
                  value={details.fullName}
                  onChange={(value) => setDetails((d) => ({ ...d, fullName: value }))}
                />
                <Field
                  id="email"
                  label="Email"
                  type="email"
                  required
                  invalid={serverErrorStep === 1 && !details.email.trim()}
                  value={details.email}
                  onChange={(value) => setDetails((d) => ({ ...d, email: value }))}
                />
                <Field
                  id="phone"
                  label="Phone"
                  type="tel"
                  value={details.phone}
                  onChange={(value) => setDetails((d) => ({ ...d, phone: value }))}
                />
                <Field
                  id="institution"
                  label="School or university"
                  required
                  invalid={serverErrorStep === 1 && !details.institution.trim()}
                  value={details.institution}
                  onChange={(value) => setDetails((d) => ({ ...d, institution: value }))}
                />
                <Field
                  id="experience"
                  label="Prior MUN experience"
                  placeholder="e.g. 3 conferences, 1 award"
                  className="sm:col-span-2"
                  value={details.experience}
                  onChange={(value) => setDetails((d) => ({ ...d, experience: value }))}
                />
                <Field
                  id="dietary"
                  label="Dietary requirements"
                  value={details.dietary}
                  onChange={(value) => setDetails((d) => ({ ...d, dietary: value }))}
                />
                <Field
                  id="accommodations"
                  label="Accessibility needs"
                  value={details.accommodations}
                  onChange={(value) => setDetails((d) => ({ ...d, accommodations: value }))}
                />
                {configurableFields.map((field) => {
                  const choices = Array.isArray(field.choices)
                    ? field.choices as string[]
                    : typeof field.choices === "string"
                      ? JSON.parse(field.choices) as string[]
                      : [];
                  const value = customFieldValues[field.fieldKey] ?? "";
                  const update = (next: string) => setCustomFieldValues((current) => ({ ...current, [field.fieldKey]: next }));
                  if (["DROPDOWN", "MULTIPLE_CHOICE"].includes(field.fieldType)) {
                    return <div key={field.id} className="flex flex-col gap-xs sm:col-span-2"><Label htmlFor={field.fieldKey}>{field.label}{field.required && " *"}</Label><select id={field.fieldKey} value={value} onChange={(event) => update(event.target.value)} required={field.required} className={selectClassName}><option value="">Select an option</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>{field.helpText && <p className="text-body-sm text-muted-foreground">{field.helpText}</p>}</div>;
                  }
                  return <Field key={field.id} id={field.fieldKey} label={field.label} type={field.fieldType === "EMAIL" ? "email" : field.fieldType === "PHONE" ? "tel" : field.fieldType === "DATE" ? "date" : "text"} required={field.required} value={value} onChange={update} className={field.fieldType === "LONG_TEXT" ? "sm:col-span-2" : undefined} placeholder={field.helpText ?? undefined} />;
                })}
              </div>

              <StepNav
                onBack={() => setStep(STEP_OPTION)}
                onNext={() => setStep(hasAccommodation ? stepAccommodation : stepReview)}
                nextDisabled={!detailsComplete}
                nextLabel={
                  hasAccommodation ? "Continue to accommodation" : "Review registration"
                }
              />
            </StepPanel>
          )}

          {hasAccommodation && activeStep === stepAccommodation && (
            <StepPanel
              title="Accommodation"
              description="Optional. Book a room through the conference, or skip this and arrange your own stay."
            >
              <AccommodationStep
                options={accommodationOptions}
                optionId={accommodationOptionId}
                onOptionChange={handleAccommodationChange}
                fields={accommodationFields}
                loadingFields={loadingFields}
                loadError={fieldsError}
                onRetry={() => setFieldsFetchNonce((nonce) => nonce + 1)}
                values={fieldValues}
                onValueChange={(fieldId, value) =>
                  setFieldValues((current) => ({ ...current, [fieldId]: value }))
                }
                showErrors={showFieldErrors}
              />

              <StepNav
                onBack={() => setStep(STEP_DETAILS)}
                onNext={handleAccommodationNext}
                // Blocked only when an option IS selected and its required
                // fields aren't satisfied. The skip path is never blocked.
                nextDisabled={accommodationBlocked}
                nextLabel="Review registration"
              />
            </StepPanel>
          )}

          {activeStep === stepReview && selected && (
            <StepPanel
              title="Review and pay"
              description="Check everything below. You'll be taken to a secure checkout to complete payment."
            >
              <dl className="divide-y divide-border rounded-md border border-border">
                <ReviewRow label="Conference" value={munName} />
                <ReviewRow label="Registration" value={selected.product.name} />
                <ReviewRow
                  label="Committee"
                  value={selectedCommittee?.name ?? "No preference"}
                />
                <ReviewRow
                  label="Portfolio"
                  value={
                    selectedCommittee?.portfolios.find((p) => p.id === portfolioId)?.name ??
                    "No preference"
                  }
                />
                <ReviewRow label="Delegate" value={details.fullName} />
                <ReviewRow label="Email" value={details.email} />
                {details.phone && <ReviewRow label="Phone" value={details.phone} />}
                <ReviewRow label="Institution" value={details.institution} />
                {details.experience && (
                  <ReviewRow label="Experience" value={details.experience} />
                )}
                {details.dietary && <ReviewRow label="Dietary" value={details.dietary} />}
                {details.accommodations && (
                  <ReviewRow label="Accessibility" value={details.accommodations} />
                )}
                {hasAccommodation && (
                  <ReviewRow
                    label="Accommodation"
                    value={
                      selectedAccommodation
                        ? `${selectedAccommodation.name} — ${formatPrice(selectedAccommodation.price)}`
                        : "None"
                    }
                  />
                )}
                {selectedAccommodation &&
                  accommodationFields.map((field) => {
                    const value = fieldValues[field.id];
                    const display = Array.isArray(value) ? value.join(", ") : (value ?? "");
                    if (!display) return null;
                    return (
                      <ReviewRow key={field.id} label={field.label} value={display} />
                    );
                  })}
                <ReviewRow label="Total due" value={formatPrice(totalPrice)} emphasis />
              </dl>

              <div className="flex items-start gap-xs rounded-md bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
                <LockIcon className="mt-px size-4 shrink-0" aria-hidden />
                <p>
                  Submitting holds your seat for 15 minutes while you pay. If payment
                  doesn&apos;t complete, the seat is released automatically and you are not
                  charged.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-sm">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setStep(hasAccommodation ? stepAccommodation : STEP_DETAILS)
                  }
                >
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <SubmitButton />
              </div>
            </StepPanel>
          )}
        </div>

        <RegistrationSummary
          munName={munName}
          slug={slug}
          selected={selected}
          committeeName={selectedCommittee?.name}
          portfolioName={
            selectedCommittee?.portfolios.find((p) => p.id === portfolioId)?.name
          }
          accommodation={
            selectedAccommodation
              ? {
                  name: selectedAccommodation.name,
                  price: selectedAccommodation.price,
                }
              : undefined
          }
          // Only advertise an accommodation row for a MUN that actually sells
          // it — otherwise a "Stay: None" line is noise.
          showAccommodationRow={hasAccommodation}
          total={totalPrice}
        />
      </div>
    </form>
  );
}

const selectClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md text-body-md text-ink transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

function StepPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-lg">
      <div className="flex flex-col gap-xxs">
        <h2 className="font-display text-title-lg text-ink">{title}</h2>
        <p className="text-body-md text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function StepNav({
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-sm">
      {onBack && (
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeftIcon aria-hidden />
          Back
        </Button>
      )}
      <Button type="button" onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2Icon className="animate-spin" aria-hidden />
          Reserving your seat…
        </>
      ) : (
        <>
          <CheckIcon aria-hidden />
          Confirm and pay
        </>
      )}
    </Button>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  invalid,
  placeholder,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex flex-col gap-xs", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
      {invalid && (
        <p id={errorId} className="text-body-md text-destructive-text">
          {label} is required.
        </p>
      )}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-md px-md py-sm">
      <dt className="text-body-md text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-right text-body-md text-ink",
          emphasis && "font-mono text-label-md font-medium tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
