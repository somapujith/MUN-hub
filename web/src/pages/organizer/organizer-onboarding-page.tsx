import * as React from "react";
import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import {
  ONBOARDING_STEPS,
  acceptAgreement,
  getOrganizerOnboarding,
  saveGstStep,
  savePanStep,
  savePaymentStep,
  saveProfileStep,
  type OnboardingStep,
  type OrganizerOnboarding,
} from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import { OrganizerBrightShell } from "@/components/organizer/organizer-bright-shell";
import { RequireOrganizer } from "@/guards/require-organizer";
import { cn } from "cn";

// Bright theme only (see OrganizerBrightShell): fixed colors, no theme tokens.
const INPUT_CLASS =
  "h-12 w-full rounded-lg border border-[#d7d7de] bg-white px-4 text-[15px] text-[#121212] outline-none transition-colors placeholder:text-[#9a9aa2] focus:border-[#121212] aria-invalid:border-[#c4320a]";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-12 items-center justify-center rounded-lg bg-[#121212] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#2a2a2e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212] disabled:cursor-not-allowed disabled:bg-[#d4d4d8] disabled:text-[#77777e]";

const STEP_LABELS: Record<OnboardingStep, string> = {
  PROFILE: "Create profile",
  PAN: "PAN details",
  GST: "GST details",
  PAYMENT: "Payment details",
  AGREEMENT: "Agreement",
};

/**
 * Organizer onboarding (publish.munhub.in/organizer/onboarding): profile, PAN,
 * GST, payout UPI and the organizer agreement, one step at a time. Required
 * before applying to host; see lib/actions/organizer-onboarding.ts.
 */
export function OrganizerOnboardingPage() {
  return (
    <RequireOrganizer>
      <Helmet>
        <title>Register as an organizer | MUN Hub</title>
      </Helmet>
      <OrganizerBrightShell menuOpenOnDesktop={false}>
        <OnboardingWizard />
      </OrganizerBrightShell>
    </RequireOrganizer>
  );
}

function OnboardingWizard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const onboarding = useQuery({ queryKey: queryKeys.organizerOnboarding(), queryFn: getOrganizerOnboarding });
  // A step the organizer went back to; otherwise the first unfinished one.
  const [revisiting, setRevisiting] = React.useState<OnboardingStep | null>(null);

  if (onboarding.isPending) {
    return <div className="flex-1" aria-busy="true" />;
  }
  if (onboarding.isError) {
    return (
      <main className="flex flex-1 items-center justify-center px-lg">
        <p role="alert" className="text-[15px] text-[#c4320a]">
          Couldn&apos;t load your organizer details. Refresh the page to try again.
        </p>
      </main>
    );
  }

  const data = onboarding.data;
  if (data.completed) return <CompletedView />;

  const current = revisiting ?? data.nextStep ?? "AGREEMENT";

  function saved(next: OrganizerOnboarding) {
    queryClient.setQueryData(queryKeys.organizerOnboarding(), next);
    setRevisiting(null);
    if (next.completed) navigate("/organizer/apply", { replace: true });
  }

  const stepProps = { data, onSaved: saved, onSkip: () => setRevisiting(null) };

  return (
    <main className="flex-1 px-lg pt-xl pb-28 md:pt-section">
      <div className="mx-auto grid w-full max-w-[1160px] gap-xl lg:grid-cols-[220px_minmax(0,690px)] lg:justify-center lg:gap-[180px]">
        <Stepper
          completed={data.completedSteps}
          current={current}
          onSelect={(step) => setRevisiting(step === data.nextStep ? null : step)}
        />
        <div className="lg:row-start-1 lg:col-start-2">
          {current === "PROFILE" ? <ProfileStep key="PROFILE" {...stepProps} /> : null}
          {current === "PAN" ? <PanStep key="PAN" {...stepProps} /> : null}
          {current === "GST" ? <GstStep key="GST" {...stepProps} /> : null}
          {current === "PAYMENT" ? <PaymentStep key="PAYMENT" {...stepProps} /> : null}
          {current === "AGREEMENT" ? <AgreementStep key="AGREEMENT" {...stepProps} /> : null}
        </div>
      </div>
    </main>
  );
}

function Stepper({
  completed,
  current,
  onSelect,
}: {
  completed: OnboardingStep[];
  current: OnboardingStep;
  onSelect: (step: OnboardingStep) => void;
}) {
  const firstOpen = ONBOARDING_STEPS.find((step) => !completed.includes(step));

  return (
    <nav aria-label="Onboarding steps" className="lg:col-start-1 lg:row-start-1 lg:self-center">
      <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible">
        {ONBOARDING_STEPS.map((step, index) => {
          const isCurrent = step === current;
          const isDone = completed.includes(step);
          const reachable = isDone || step === firstOpen;
          return (
            <li key={step} className="shrink-0">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(step)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 border-b-2 px-3 py-3 text-left text-[14px] transition-colors lg:border-b-0 lg:border-l-2 lg:py-3.5 lg:pl-3",
                  isCurrent
                    ? "border-[#121212] font-semibold text-[#121212]"
                    : "border-[#e2e2e8] text-[#8a8a92]",
                  reachable && !isCurrent ? "hover:text-[#121212]" : null,
                  !reachable ? "cursor-not-allowed" : null,
                )}
              >
                <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                <span className="whitespace-nowrap">{STEP_LABELS[step]}</span>
                {isDone && !isCurrent ? <CheckIcon aria-label="done" className="size-4 text-[#1f8a4c]" /> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface StepProps {
  data: OrganizerOnboarding;
  onSaved: (next: OrganizerOnboarding) => void;
  /** Leave the step unchanged and return to the first unfinished one. */
  onSkip: () => void;
}

function StepFrame({
  title,
  description,
  error,
  submitLabel,
  submitting,
  canSubmit = true,
  onSubmit,
  children,
}: {
  title: string;
  description?: ReactNode;
  error: string | null;
  submitLabel: string;
  submitting: boolean;
  canSubmit?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!submitting && canSubmit) onSubmit();
      }}
      className="flex flex-col gap-lg"
    >
      <header className="flex flex-col gap-xs">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-[#121212] md:text-[34px]">{title}</h1>
        {description ? <p className="text-[15px] text-[#5b5b63]">{description}</p> : null}
      </header>
      {children}
      {error ? (
        <p role="alert" className="text-[14px] text-[#c4320a]">
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={submitting || !canSubmit}>
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] text-[#5b5b63]">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[13px] text-[#8a8a92]">{hint}</p> : null}
    </div>
  );
}

function PhoneInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-12 w-full max-w-[300px] overflow-hidden rounded-lg border bg-white transition-colors focus-within:border-[#121212]",
        invalid ? "border-[#c4320a]" : "border-[#d7d7de]",
      )}
    >
      <span className="flex items-center border-r border-[#d7d7de] px-4 text-[15px] text-[#121212]">+91</span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        placeholder="e.g. 9876543210"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 10))}
        aria-invalid={invalid ? true : undefined}
        className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-[#121212] outline-none placeholder:text-[#9a9aa2]"
      />
    </div>
  );
}

function useStepMutation<T>(save: (input: T) => Promise<OrganizerOnboarding>, onSaved: StepProps["onSaved"]) {
  const mutation = useMutation({ mutationFn: save, onSuccess: onSaved });
  const error = mutation.error instanceof Error ? mutation.error.message : mutation.error ? "Couldn't save. Try again." : null;
  return { mutation, error };
}

const TEN_DIGITS = /^[6-9]\d{9}$/;

function ProfileStep({ data, onSaved }: StepProps) {
  const [firstName, setFirstName] = React.useState(data.profile.firstName ?? "");
  const [lastName, setLastName] = React.useState(data.profile.lastName ?? "");
  const [phone, setPhone] = React.useState(data.profile.contactPhone ?? "");
  const { mutation, error } = useStepMutation(saveProfileStep, onSaved);
  const phoneLooksWrong = phone.length === 10 && !TEN_DIGITS.test(phone);

  return (
    <StepFrame
      title="Create your organizer profile"
      error={error ?? (phoneLooksWrong ? "Enter a valid 10-digit mobile number." : null)}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={Boolean(firstName.trim() && lastName.trim() && TEN_DIGITS.test(phone))}
      onSubmit={() => mutation.mutate({ firstName, lastName, contactPhone: phone })}
    >
      <div className="grid gap-md sm:grid-cols-2">
        <Field id="onboarding-first-name" label="First name">
          <input
            id="onboarding-first-name"
            autoComplete="given-name"
            placeholder="e.g. Rahul"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="onboarding-last-name" label="Last name">
          <input
            id="onboarding-last-name"
            autoComplete="family-name"
            placeholder="e.g. Sharma"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field id="onboarding-phone" label="Contact number">
        <PhoneInput id="onboarding-phone" value={phone} onChange={setPhone} invalid={phoneLooksWrong} />
      </Field>
    </StepFrame>
  );
}

const PAN_FORMAT = /^[A-Z]{5}\d{4}[A-Z]$/;

function PanStep({ data, onSaved, onSkip }: StepProps) {
  const [panNumber, setPanNumber] = React.useState("");
  const [panName, setPanName] = React.useState(data.profile.panName ?? "");
  const { mutation, error } = useStepMutation(savePanStep, onSaved);
  const savedLast4 = data.profile.panLast4;
  // A saved PAN is never sent back, so leaving it blank keeps the saved one.
  const keepSaved = Boolean(savedLast4) && panNumber === "" && panName.trim() === (data.profile.panName ?? "");

  return (
    <StepFrame
      title="Add your PAN details"
      description="Payouts for your MUNs are made against this PAN."
      error={error}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={keepSaved || (PAN_FORMAT.test(panNumber) && Boolean(panName.trim()))}
      onSubmit={() => (keepSaved ? onSkip() : mutation.mutate({ panNumber, panName }))}
    >
      <Field
        id="onboarding-pan"
        label="PAN number"
        hint={savedLast4 ? `PAN ending ${savedLast4} is saved. Enter it again only to change it.` : undefined}
      >
        <input
          id="onboarding-pan"
          autoComplete="off"
          spellCheck={false}
          maxLength={10}
          placeholder="e.g. ABCDE1234F"
          value={panNumber}
          onChange={(event) => setPanNumber(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())}
          className={cn(INPUT_CLASS, "max-w-[300px] font-mono tracking-[0.08em] uppercase")}
        />
      </Field>
      <Field id="onboarding-pan-name" label="Name as on PAN">
        <input
          id="onboarding-pan-name"
          placeholder="e.g. Rahul Sharma"
          value={panName}
          onChange={(event) => setPanName(event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
    </StepFrame>
  );
}

const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function GstStep({ data, onSaved }: StepProps) {
  const [hasGstin, setHasGstin] = React.useState<boolean | null>(data.profile.hasGstin);
  const [gstin, setGstin] = React.useState(data.profile.gstin ?? "");
  const { mutation, error } = useStepMutation(saveGstStep, onSaved);

  return (
    <StepFrame
      title="GST details"
      description="Do you have a GSTIN for the person or organization on your PAN?"
      error={error}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={hasGstin === false || (hasGstin === true && GSTIN_FORMAT.test(gstin))}
      onSubmit={() => mutation.mutate(hasGstin ? { hasGstin: true, gstin } : { hasGstin: false })}
    >
      <fieldset className="flex flex-wrap gap-md">
        <legend className="sr-only">Do you have a GSTIN?</legend>
        {[
          { value: true, label: "Yes, I have a GSTIN" },
          { value: false, label: "No, I don't have one" },
        ].map((option) => (
          <label
            key={option.label}
            className={cn(
              "flex h-12 cursor-pointer items-center gap-3 rounded-lg border bg-white px-4 text-[15px] text-[#121212] transition-colors",
              hasGstin === option.value ? "border-[#121212]" : "border-[#d7d7de] hover:border-[#9a9aa2]",
            )}
          >
            <input
              type="radio"
              name="has-gstin"
              checked={hasGstin === option.value}
              onChange={() => setHasGstin(option.value)}
              className="size-4 accent-[#121212]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {hasGstin ? (
        <Field id="onboarding-gstin" label="GSTIN">
          <input
            id="onboarding-gstin"
            autoComplete="off"
            spellCheck={false}
            maxLength={15}
            placeholder="e.g. 27ABCDE1234F1Z5"
            value={gstin}
            onChange={(event) => setGstin(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())}
            className={cn(INPUT_CLASS, "max-w-[360px] font-mono tracking-[0.06em] uppercase")}
          />
        </Field>
      ) : null}
    </StepFrame>
  );
}

const UPI_FORMAT = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

function PaymentStep({ data, onSaved }: StepProps) {
  const [upiId, setUpiId] = React.useState(data.profile.upiId ?? "");
  const [upiPhone, setUpiPhone] = React.useState(data.profile.upiPhone ?? "");
  const { mutation, error } = useStepMutation(savePaymentStep, onSaved);
  const upiLooksWrong = upiId.includes("@") && upiId.length > 4 && !UPI_FORMAT.test(upiId.trim());

  return (
    <StepFrame
      title="Payment details"
      description="Delegate payments for your MUNs will be sent to this UPI ID."
      error={error ?? (upiLooksWrong ? "UPI IDs look like name@bank." : null)}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={UPI_FORMAT.test(upiId.trim()) && TEN_DIGITS.test(upiPhone)}
      onSubmit={() => mutation.mutate({ upiId, upiPhone })}
    >
      <Field id="onboarding-upi" label="UPI ID">
        <input
          id="onboarding-upi"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="e.g. rahulsharma@okhdfcbank"
          value={upiId}
          onChange={(event) => setUpiId(event.target.value.trim())}
          aria-invalid={upiLooksWrong ? true : undefined}
          className={cn(INPUT_CLASS, "max-w-[420px]")}
        />
      </Field>
      <Field
        id="onboarding-upi-phone"
        label="Mobile number linked to this UPI ID"
        hint="Payouts are sent to this UPI ID. Double-check it — it can't be changed here once you submit."
      >
        <PhoneInput id="onboarding-upi-phone" value={upiPhone} onChange={setUpiPhone} />
      </Field>
    </StepFrame>
  );
}

const AGREEMENT_POINTS = [
  "Everything you publish about your conference — dates, venue, committees, fees — is accurate, and you'll keep it up to date.",
  "MUN Hub reviews every application and listing before it goes live, and may ask for changes, pause or remove a listing.",
  "Delegate payments collected on MUN Hub are settled to the UPI ID you provided, after any applicable fees and refunds.",
  "You'll honour your published refund policy and handle delegate queries promptly.",
  "You'll use delegate details only to run your conference, and keep them secure.",
];

function AgreementStep({ data, onSaved }: StepProps) {
  const [accepted, setAccepted] = React.useState(false);
  const { mutation, error } = useStepMutation(() => acceptAgreement(), onSaved);

  return (
    <StepFrame
      title="Organizer agreement"
      description={`Version ${data.agreementVersion}. Please read before submitting.`}
      error={error}
      submitLabel="Submit and continue"
      submitting={mutation.isPending}
      canSubmit={accepted}
      onSubmit={() => mutation.mutate(undefined)}
    >
      <div className="max-h-[320px] overflow-y-auto rounded-lg border border-[#d7d7de] bg-white p-5">
        <p className="text-[15px] font-semibold text-[#121212]">By hosting on MUN Hub, you agree that:</p>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[14px] leading-relaxed text-[#3d3d44]">
          {AGREEMENT_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-[15px] text-[#121212]">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1 size-4 accent-[#121212]"
        />
        I have read and agree to the MUN Hub organizer agreement. My organizer details can&apos;t be changed here
        after I submit.
      </label>
    </StepFrame>
  );
}

function CompletedView() {
  return (
    <main className="flex flex-1 items-center justify-center px-lg pb-28">
      <div className="flex max-w-[520px] flex-col items-start gap-md">
        <span className="flex size-12 items-center justify-center rounded-full bg-[#e7f6ee] text-[#1f8a4c]">
          <CheckIcon aria-hidden className="size-6" />
        </span>
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-[#121212]">
          You&apos;re registered as an organizer
        </h1>
        <p className="text-[15px] text-[#5b5b63]">
          Your details are on file. To change them, contact support from the chat button.
        </p>
        <Link to="/organizer/apply" className={PRIMARY_BUTTON_CLASS}>
          Apply to host a MUN
        </Link>
      </div>
    </main>
  );
}
