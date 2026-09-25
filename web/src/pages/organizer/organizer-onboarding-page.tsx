import * as React from "react";
import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import {
  MAX_EXPECTED_DELEGATES,
  MAX_ORGANIZATION_LENGTH,
  MIN_DESCRIPTION_LENGTH,
  ONBOARDING_STEPS,
  acceptAgreement,
  getOrganizerOnboarding,
  saveDetailsStep,
  saveMunStep,
  savePaymentStep,
  saveProfileStep,
  type OnboardingStep,
  type OrganizerOnboarding,
} from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import {
  BRIGHT_INPUT_CLASS,
  BRIGHT_PRIMARY_BUTTON_CLASS,
  BRIGHT_TEXTAREA_CLASS,
  BrightField,
  DATE_INPUT_FORMAT,
  WEBSITE_FORMAT,
} from "@/components/organizer/bright-form";
import { OrganizerBrightWizardSkeleton } from "@/components/organizer/organizer-bright-skeleton";
import { OrganizerBrightShell } from "@/components/organizer/organizer-bright-shell";
import { RequireOrganizer } from "@/guards/require-organizer";
import { cn } from "cn";

const STEP_LABELS: Record<OnboardingStep, string> = {
  PROFILE: "Create profile",
  MUN: "Your MUN",
  DETAILS: "Delegates & details",
  PAYMENT: "Payment details",
  AGREEMENT: "Agreement",
};

/**
 * Organizer onboarding (publish.munhub.in/organizer/onboarding): profile, the
 * organizer's MUN, delegates & details, payout bank details (+ an optional
 * UPI ID) and the organizer agreement, one step at a time. Accepting the
 * agreement submits the MUN as the organizer's application; see
 * lib/actions/organizer-onboarding.ts.
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
    return <OrganizerBrightWizardSkeleton />;
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
    if (next.completed) navigate("/organizer/apply/submitted", { replace: true });
  }

  const stepProps = { data, onSaved: saved };

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
          {current === "MUN" ? <MunStep key="MUN" {...stepProps} /> : null}
          {current === "DETAILS" ? <DetailsStep key="DETAILS" {...stepProps} /> : null}
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
    // min-w-0: this is a grid item below `lg` (the wrapping grid has no
    // explicit column sizing outside `lg:grid-cols-[...]`), so without it the
    // step row's own overflow-x-auto below never gets a chance to clip/scroll
    // — the grid item's automatic min width is content-based and just forces
    // the whole grid (and page) wider instead.
    <nav aria-label="Onboarding steps" className="min-w-0 lg:col-start-1 lg:row-start-1 lg:self-center">
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
        <button type="submit" className={BRIGHT_PRIMARY_BUTTON_CLASS} disabled={submitting || !canSubmit}>
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
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
  const [organization, setOrganization] = React.useState(data.profile.organization ?? "");
  const { mutation, error } = useStepMutation(saveProfileStep, onSaved);
  const phoneLooksWrong = phone.length === 10 && !TEN_DIGITS.test(phone);

  return (
    <StepFrame
      title="Create your organizer profile"
      error={error ?? (phoneLooksWrong ? "Enter a valid 10-digit mobile number." : null)}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={Boolean(firstName.trim() && lastName.trim() && organization.trim() && TEN_DIGITS.test(phone))}
      onSubmit={() => mutation.mutate({ firstName, lastName, contactPhone: phone, organization })}
    >
      <div className="grid gap-md sm:grid-cols-2">
        <BrightField id="onboarding-first-name" label="First name">
          <input
            id="onboarding-first-name"
            autoComplete="given-name"
            placeholder="e.g. Rahul"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <BrightField id="onboarding-last-name" label="Last name">
          <input
            id="onboarding-last-name"
            autoComplete="family-name"
            placeholder="e.g. Sharma"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
      </div>
      <BrightField
        id="onboarding-organization"
        label="Organizing body"
        hint="The school, college or society hosting your MUN. Delegates see it as the host."
      >
        <input
          id="onboarding-organization"
          autoComplete="organization"
          placeholder="e.g. Deccan Debating Society"
          maxLength={MAX_ORGANIZATION_LENGTH}
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          className={BRIGHT_INPUT_CLASS}
        />
      </BrightField>
      <BrightField id="onboarding-phone" label="Contact number">
        <PhoneInput id="onboarding-phone" value={phone} onChange={setPhone} invalid={phoneLooksWrong} />
      </BrightField>
    </StepFrame>
  );
}

function MunStep({ data, onSaved }: StepProps) {
  const [munName, setMunName] = React.useState(data.profile.munName ?? "");
  const [munCity, setMunCity] = React.useState(data.profile.munCity ?? "");
  const [munStartDate, setMunStartDate] = React.useState(data.profile.munStartDate ?? "");
  const [today] = React.useState(() => new Date().toISOString().slice(0, 10));
  const { mutation, error } = useStepMutation(saveMunStep, onSaved);

  return (
    <StepFrame
      title="Tell us about your MUN"
      description="This becomes your application to host on MUN Hub."
      error={error}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={Boolean(munName.trim() && munCity.trim() && DATE_INPUT_FORMAT.test(munStartDate))}
      onSubmit={() => mutation.mutate({ munName, munCity, munStartDate })}
    >
      <BrightField id="onboarding-mun-name" label="Title of your MUN">
        <input
          id="onboarding-mun-name"
          placeholder="e.g. Hyderabad MUN 2027"
          value={munName}
          onChange={(event) => setMunName(event.target.value)}
          className={BRIGHT_INPUT_CLASS}
        />
      </BrightField>
      <div className="grid gap-md sm:grid-cols-2">
        <BrightField id="onboarding-mun-city" label="Host city">
          <input
            id="onboarding-mun-city"
            autoComplete="address-level2"
            placeholder="e.g. Hyderabad"
            value={munCity}
            onChange={(event) => setMunCity(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <BrightField id="onboarding-mun-date" label="Expected start date">
          <input
            id="onboarding-mun-date"
            type="date"
            min={today}
            value={munStartDate}
            onChange={(event) => setMunStartDate(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
      </div>
    </StepFrame>
  );
}

function DetailsStep({ data, onSaved }: StepProps) {
  const [count, setCount] = React.useState(data.profile.expectedDelegateCount?.toString() ?? "");
  const [description, setDescription] = React.useState(data.profile.munDescription ?? "");
  const [previousEditions, setPreviousEditions] = React.useState(data.profile.previousEditions ?? "");
  const [websiteUrl, setWebsiteUrl] = React.useState(data.profile.websiteUrl ?? "");
  const { mutation, error } = useStepMutation(saveDetailsStep, onSaved);

  const delegates = Number(count);
  const countValid = /^\d+$/.test(count) && delegates >= 1 && delegates <= MAX_EXPECTED_DELEGATES;
  const descriptionLength = description.trim().length;
  const website = websiteUrl.trim();
  const websiteLooksWrong = website.length > 8 && !WEBSITE_FORMAT.test(website);

  return (
    <StepFrame
      title="Delegates & details"
      error={error ?? (websiteLooksWrong ? "Enter the full website address, including https://" : null)}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={
        countValid &&
        descriptionLength >= MIN_DESCRIPTION_LENGTH &&
        (website === "" || WEBSITE_FORMAT.test(website))
      }
      onSubmit={() =>
        mutation.mutate({
          expectedDelegateCount: delegates,
          munDescription: description,
          previousEditions: previousEditions || undefined,
          websiteUrl: website || undefined,
        })
      }
    >
      <BrightField id="onboarding-delegates" label="Maximum delegates you expect">
        <input
          id="onboarding-delegates"
          inputMode="numeric"
          placeholder="e.g. 300"
          value={count}
          onChange={(event) => setCount(event.target.value.replace(/\D/g, "").slice(0, 5))}
          className={cn(BRIGHT_INPUT_CLASS, "max-w-[200px]")}
        />
      </BrightField>
      <BrightField
        id="onboarding-description"
        label="About your MUN"
        hint={
          descriptionLength < MIN_DESCRIPTION_LENGTH
            ? `At least ${MIN_DESCRIPTION_LENGTH} characters (${descriptionLength} so far)`
            : undefined
        }
      >
        <textarea
          id="onboarding-description"
          placeholder="Committees, format, who it's for, what makes it different…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={BRIGHT_TEXTAREA_CLASS}
        />
      </BrightField>
      <div className="grid gap-md sm:grid-cols-2">
        <BrightField id="onboarding-previous-editions" label="Previous editions (optional)">
          <input
            id="onboarding-previous-editions"
            placeholder="e.g. 3 editions since 2022"
            value={previousEditions}
            onChange={(event) => setPreviousEditions(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <BrightField id="onboarding-website" label="Website (optional)">
          <input
            id="onboarding-website"
            type="url"
            autoComplete="url"
            placeholder="https://"
            value={websiteUrl}
            onChange={(event) => setWebsiteUrl(event.target.value)}
            aria-invalid={websiteLooksWrong ? true : undefined}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
      </div>
    </StepFrame>
  );
}

// MUN Hub only accepts payouts to a FreeCharge UPI handle (@freecharge) —
// user-directed restriction, mirrors lib/actions/organizer-onboarding.ts's UPI_PATTERN.
// UPI itself is optional (2026-09-26) — bank details below are the required payout method.
const UPI_FORMAT = /^[a-zA-Z0-9._-]{2,256}@freecharge$/;
const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_ACCOUNT_FORMAT = /^\d{9,18}$/;

function PaymentStep({ data, onSaved }: StepProps) {
  const [accountHolderName, setAccountHolderName] = React.useState(data.profile.accountHolderName ?? "");
  const [bankName, setBankName] = React.useState(data.profile.bankName ?? "");
  // Never prefilled — the saved account number is write-only and isn't returned by the server.
  const [accountNumber, setAccountNumber] = React.useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = React.useState("");
  const [ifscCode, setIfscCode] = React.useState(data.profile.ifscCode ?? "");
  const [upiId, setUpiId] = React.useState(data.profile.upiId ?? "");
  // Only prefill the linked phone when a UPI ID was already saved — otherwise the account's
  // default phone would show up next to an empty UPI ID and block submission (see below).
  const [upiPhone, setUpiPhone] = React.useState(data.profile.upiId ? (data.profile.upiPhone ?? "") : "");
  const { mutation, error } = useStepMutation(savePaymentStep, onSaved);

  const accountNumberDigits = accountNumber.replace(/\s+/g, "");
  const accountNumberValid = BANK_ACCOUNT_FORMAT.test(accountNumberDigits);
  const accountNumbersMatch = accountNumber === confirmAccountNumber;
  const trimmedIfsc = ifscCode.trim().toUpperCase();
  const ifscLooksWrong = trimmedIfsc.length > 0 && !IFSC_FORMAT.test(trimmedIfsc);
  // If a UPI ID has been started, its linked phone becomes required too — the
  // same "give both or neither" rule lib/actions/organizer-onboarding.ts enforces.
  const upiEntered = upiId.trim().length > 0;
  const upiLooksWrong = upiEntered && !UPI_FORMAT.test(upiId.trim());

  const bankFieldsValid = Boolean(
    accountHolderName.trim() && bankName.trim() && accountNumberValid && accountNumbersMatch && IFSC_FORMAT.test(trimmedIfsc),
  );
  const upiFieldsValid = !upiEntered || (UPI_FORMAT.test(upiId.trim()) && TEN_DIGITS.test(upiPhone));

  const clientError =
    (accountNumber && confirmAccountNumber && !accountNumbersMatch ? "Account numbers don't match." : null) ??
    (accountNumber && !accountNumberValid ? "Account number must be 9 to 18 digits." : null) ??
    (ifscLooksWrong ? "Enter a valid IFSC code, e.g. HDFC0001234." : null) ??
    (upiLooksWrong ? "Only a FreeCharge UPI ID is accepted — it must look like name@freecharge." : null) ??
    (upiEntered && upiPhone && !TEN_DIGITS.test(upiPhone) ? "Enter a valid 10-digit mobile number." : null);

  return (
    <StepFrame
      title="Payment details"
      description="Add the bank account payouts should go to. A UPI ID is an optional backup payout address."
      error={error ?? clientError}
      submitLabel="Continue"
      submitting={mutation.isPending}
      canSubmit={bankFieldsValid && upiFieldsValid}
      onSubmit={() =>
        mutation.mutate({
          accountHolderName,
          bankName,
          bankAccountNumber: accountNumberDigits,
          ifscCode: trimmedIfsc,
          upiId: upiEntered ? upiId.trim() : undefined,
          upiPhone: upiEntered ? upiPhone : undefined,
        })
      }
    >
      <BrightField id="onboarding-account-holder" label="Account holder name">
        <input
          id="onboarding-account-holder"
          autoComplete="off"
          placeholder="As it appears on your bank account"
          value={accountHolderName}
          onChange={(event) => setAccountHolderName(event.target.value)}
          className={BRIGHT_INPUT_CLASS}
        />
      </BrightField>
      <BrightField id="onboarding-bank-name" label="Bank name">
        <input
          id="onboarding-bank-name"
          autoComplete="off"
          placeholder="e.g. HDFC Bank"
          value={bankName}
          onChange={(event) => setBankName(event.target.value)}
          className={BRIGHT_INPUT_CLASS}
        />
      </BrightField>
      <div className="grid gap-md sm:grid-cols-2">
        <BrightField id="onboarding-account-number" label="Account number">
          <input
            id="onboarding-account-number"
            inputMode="numeric"
            autoComplete="off"
            placeholder="9 to 18 digits"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value.replace(/[^\d\s]/g, ""))}
            aria-invalid={accountNumber && !accountNumberValid ? true : undefined}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <BrightField id="onboarding-confirm-account-number" label="Confirm account number">
          <input
            id="onboarding-confirm-account-number"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Re-enter the account number"
            value={confirmAccountNumber}
            onChange={(event) => setConfirmAccountNumber(event.target.value.replace(/[^\d\s]/g, ""))}
            aria-invalid={confirmAccountNumber && !accountNumbersMatch ? true : undefined}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
      </div>
      <BrightField id="onboarding-ifsc" label="IFSC code" hint="Found on a cheque leaf or your bank's passbook, e.g. HDFC0001234.">
        <input
          id="onboarding-ifsc"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          maxLength={11}
          placeholder="e.g. HDFC0001234"
          value={ifscCode}
          onChange={(event) => setIfscCode(event.target.value.toUpperCase())}
          aria-invalid={ifscLooksWrong ? true : undefined}
          className={cn(BRIGHT_INPUT_CLASS, "max-w-[240px] uppercase")}
        />
      </BrightField>

      <div className="mt-2 flex flex-col gap-lg border-t border-[#e2e2e8] pt-lg">
        <p className="text-[13px] font-semibold tracking-wide text-[#8a8a92] uppercase">Optional backup payout</p>
        <BrightField id="onboarding-upi" label="UPI ID (optional)">
          <input
            id="onboarding-upi"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            placeholder="e.g. rahulsharma@freecharge"
            value={upiId}
            onChange={(event) => setUpiId(event.target.value.trim())}
            aria-invalid={upiLooksWrong ? true : undefined}
            className={cn(BRIGHT_INPUT_CLASS, "max-w-[420px]")}
          />
        </BrightField>
        <BrightField
          id="onboarding-upi-phone"
          label="Mobile number linked to this UPI ID (optional)"
          hint="Only needed if you give a UPI ID above. MUN Hub only accepts FreeCharge UPI handles."
        >
          <PhoneInput id="onboarding-upi-phone" value={upiPhone} onChange={setUpiPhone} />
        </BrightField>
      </div>
    </StepFrame>
  );
}

const AGREEMENT_POINTS = [
  "Everything you publish about your conference — dates, venue, committees, fees — is accurate, and you'll keep it up to date.",
  "MUN Hub reviews every application and listing before it goes live, and may ask for changes, pause or remove a listing.",
  "Delegate payments collected on MUN Hub are settled to the bank account you provided, less MUN Hub's platform fee.",
  "Registrations on MUN Hub are final: you won't promise delegates refunds, and you'll handle their queries promptly.",
  "You'll use delegate details only to run your conference, and keep them secure.",
];

function AgreementStep({ data, onSaved }: StepProps) {
  const [accepted, setAccepted] = React.useState(false);
  const { mutation, error } = useStepMutation(() => acceptAgreement(), onSaved);

  return (
    <StepFrame
      title="Organizer agreement"
      description={`Version ${data.agreementVersion}. Submitting sends your MUN to our team for review.`}
      error={error}
      submitLabel="Submit application"
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
          Your MUN application is with our team — we review every application within 2 business days. To change
          your details, contact support from the chat button.
        </p>
        <div className="flex flex-wrap items-center gap-md">
          <Link to="/organizer/dashboard" className={BRIGHT_PRIMARY_BUTTON_CLASS}>
            Go to your dashboard
          </Link>
          <Link to="/organizer/apply" className="text-[15px] font-medium text-[#121212] underline underline-offset-2">
            Host another MUN
          </Link>
        </div>
      </div>
    </main>
  );
}
