import * as React from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  requestOrganizerCode,
  verifyOrganizerCode,
  type OrganizerCodeVerification,
  type OrganizerProfileInput,
} from "@/api/organizer-auth";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirectTo } from "@/lib/redirect";
import { cn } from "cn";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_MS = 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Soft, borderless field and a tall rounded button, per the reference design.
const FIELD_CLASS =
  "h-12 rounded-xl border-transparent bg-card px-lg shadow-[0_2px_12px_rgba(24,29,38,0.08)] dark:border-border";
const BUTTON_CLASS = "h-12 w-full rounded-xl text-body-md font-semibold";

type SignedIn = Extract<OrganizerCodeVerification, { status: "SIGNED_IN" }>;

interface SignupDraft {
  name: string;
  email: string;
  phone: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
}

const EMPTY_DRAFT: SignupDraft = { name: "", email: "", phone: "", acceptedTerms: false, acceptedPrivacy: false };

type Step =
  | { name: "email"; email: string }
  | { name: "details"; draft: SignupDraft }
  | { name: "code"; email: string; draft?: SignupDraft }
  | { name: "profile"; email: string; code: string };

function toProfile(draft: SignupDraft): OrganizerProfileInput {
  return {
    name: draft.name.trim(),
    phone: draft.phone.trim() || undefined,
    acceptedTermsOfService: draft.acceptedTerms,
    acceptedPrivacyPolicy: draft.acceptedPrivacy,
  };
}

/**
 * Passwordless organizer auth; see lib/actions/organizer-otp.ts. There is no
 * organizer password anywhere.
 *
 * - `login`: email → emailed 6-digit code → signed in. An address with no
 *   account yet is asked for a name and consent after the code, then created.
 * - `signup`: name, email, phone and consent first → emailed code confirms the
 *   address → account created.
 */
export function OrganizerOtpForm({ mode }: { mode: "login" | "signup" }) {
  const [step, setStep] = React.useState<Step>(
    mode === "signup" ? { name: "details", draft: EMPTY_DRAFT } : { name: "email", email: "" },
  );
  const completeSignIn = useCompleteSignIn();

  let content: ReactNode;
  switch (step.name) {
    case "email":
      content = <EmailStep initialEmail={step.email} onSent={(email) => setStep({ name: "code", email })} />;
      break;
    case "details":
      content = (
        <DetailsStep
          initialDraft={step.draft}
          onSent={(draft) => setStep({ name: "code", email: draft.email.trim().toLowerCase(), draft })}
        />
      );
      break;
    case "code":
      content = (
        <CodeStep
          email={step.email}
          profile={step.draft ? toProfile(step.draft) : undefined}
          onChangeEmail={() =>
            setStep(step.draft ? { name: "details", draft: step.draft } : { name: "email", email: step.email })
          }
          onProfileRequired={(code) => setStep({ name: "profile", email: step.email, code })}
          onSignedIn={completeSignIn}
        />
      );
      break;
    case "profile":
      content = (
        <ProfileStep
          email={step.email}
          code={step.code}
          onStartOver={() => setStep({ name: "email", email: step.email })}
          onSignedIn={completeSignIn}
        />
      );
      break;
  }

  return (
    <div className="w-full max-w-[400px]">
      {content}
      <SwitchModeLink mode={mode} />
    </div>
  );
}

function SwitchModeLink({ mode }: { mode: "login" | "signup" }) {
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const target = mode === "login" ? "/organizer/signup" : "/organizer/login";

  return (
    <p className="mt-xl text-center text-body-md text-muted-foreground">
      {mode === "login" ? "New to MUN Hub? " : "Already have an organizer account? "}
      <Link
        to={search ? `${target}?${search}` : target}
        className="font-medium text-link underline-offset-2 hover:underline"
      >
        {mode === "login" ? "Create an organizer account" : "Log in"}
      </Link>
    </p>
  );
}

function useCompleteSignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));

  return (result: SignedIn) => {
    // Drop anything cached under the previous identity, then seed the session
    // so the organizer guards see the new account without a refetch.
    queryClient.clear();
    queryClient.setQueryData(queryKeys.session(), { userId: result.userId, role: result.role });
    const home = result.isNewAccount ? "/organizer/welcome" : "/organizer/dashboard";
    navigate(redirectTo !== "/" ? redirectTo : home, { replace: true });
  };
}

function StepHeader({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <header className="flex flex-col items-center gap-xs text-center">
      <h1 className="font-display text-title-lg font-semibold text-ink md:text-display-md">{title}</h1>
      <p className="text-body-md text-muted-foreground">{subtitle}</p>
    </header>
  );
}

function ErrorMessage({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text"
    >
      {message}
    </p>
  );
}

function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

function EmailStep({ initialEmail, onSent }: { initialEmail: string; onSent: (email: string) => void }) {
  const [email, setEmail] = React.useState(initialEmail);
  const normalized = email.trim().toLowerCase();
  const isValid = EMAIL_PATTERN.test(normalized);

  const sendCode = useMutation({
    mutationFn: requestOrganizerCode,
    onSuccess: () => onSent(normalized),
  });
  const error = errorText(sendCode.error, "Could not send the code.");

  return (
    <>
      <StepHeader title="Log in" subtitle="to publish your MUN" />
      <form
        className="mt-xl flex flex-col gap-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (isValid && !sendCode.isPending) sendCode.mutate(normalized);
        }}
      >
        <Label htmlFor="organizer-email" className="sr-only">
          Email address
        </Label>
        <Input
          id="organizer-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="Enter email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "organizer-email-error" : undefined}
          className={FIELD_CLASS}
        />
        <ErrorMessage id="organizer-email-error" message={error} />
        <Button type="submit" className={BUTTON_CLASS} disabled={!isValid || sendCode.isPending}>
          {sendCode.isPending ? "Sending OTP…" : "Send OTP"}
        </Button>
      </form>
    </>
  );
}

function DetailsStep({ initialDraft, onSent }: { initialDraft: SignupDraft; onSent: (draft: SignupDraft) => void }) {
  const [draft, setDraft] = React.useState(initialDraft);
  const [formError, setFormError] = React.useState<string | null>(null);
  const update = (patch: Partial<SignupDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const sendCode = useMutation({
    mutationFn: requestOrganizerCode,
    onSuccess: () => onSent(draft),
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const email = draft.email.trim().toLowerCase();
    if (!draft.name.trim()) return setFormError("Enter your full name.");
    if (!EMAIL_PATTERN.test(email)) return setFormError("Enter a valid email address.");
    if (!draft.acceptedTerms || !draft.acceptedPrivacy) {
      return setFormError("Accept the Terms of Service and Privacy Policy to continue.");
    }
    if (!sendCode.isPending) sendCode.mutate(email);
  }

  const error = formError ?? errorText(sendCode.error, "Could not send the code.");

  return (
    <>
      <StepHeader title="Create your organizer account" subtitle="We'll email you a code to confirm it's you" />
      <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md" noValidate>
        <Label htmlFor="organizer-name" className="sr-only">
          Full name
        </Label>
        <Input
          id="organizer-name"
          autoComplete="name"
          autoFocus
          required
          placeholder="Full name"
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          className={FIELD_CLASS}
        />
        <Label htmlFor="organizer-signup-email" className="sr-only">
          Email address
        </Label>
        <Input
          id="organizer-signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="Email address"
          value={draft.email}
          onChange={(event) => update({ email: event.target.value })}
          className={FIELD_CLASS}
        />
        <Label htmlFor="organizer-phone" className="sr-only">
          Phone (optional)
        </Label>
        <Input
          id="organizer-phone"
          type="tel"
          autoComplete="tel"
          placeholder="Phone (optional)"
          value={draft.phone}
          onChange={(event) => update({ phone: event.target.value })}
          className={FIELD_CLASS}
        />
        <ConsentCheckboxes
          acceptedTerms={draft.acceptedTerms}
          acceptedPrivacy={draft.acceptedPrivacy}
          onChange={update}
        />
        <ErrorMessage id="organizer-details-error" message={error} />
        <Button type="submit" className={BUTTON_CLASS} disabled={sendCode.isPending}>
          {sendCode.isPending ? "Sending OTP…" : "Send OTP"}
        </Button>
      </form>
    </>
  );
}

function ConsentCheckboxes({
  acceptedTerms,
  acceptedPrivacy,
  onChange,
}: {
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  onChange: (patch: { acceptedTerms?: boolean; acceptedPrivacy?: boolean }) => void;
}) {
  // Plain divs, not wrapping <label>s: <Label> already renders a label element,
  // and labels can't nest.
  // TODO: link the policy text once /legal/terms and /legal/privacy ship.
  return (
    <>
      <div className="flex items-start gap-sm">
        <Checkbox
          id="organizer-terms"
          checked={acceptedTerms}
          onCheckedChange={(checked) => onChange({ acceptedTerms: checked === true })}
        />
        <Label htmlFor="organizer-terms" className="cursor-pointer text-body-md font-normal text-body">
          I agree to the Terms of Service
        </Label>
      </div>
      <div className="flex items-start gap-sm">
        <Checkbox
          id="organizer-privacy"
          checked={acceptedPrivacy}
          onCheckedChange={(checked) => onChange({ acceptedPrivacy: checked === true })}
        />
        <Label htmlFor="organizer-privacy" className="cursor-pointer text-body-md font-normal text-body">
          I agree to the Privacy Policy
        </Label>
      </div>
    </>
  );
}

/** Whole seconds until `target`, ticking once a second until it reaches zero. */
function useSecondsUntil(target: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  const done = now >= target;

  React.useEffect(() => {
    if (done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [done]);

  return Math.max(0, Math.ceil((target - now) / 1000));
}

function CodeStep({
  email,
  profile,
  onChangeEmail,
  onProfileRequired,
  onSignedIn,
}: {
  email: string;
  /** Present on signup: the account is created as soon as the code checks out. */
  profile?: OrganizerProfileInput;
  onChangeEmail: () => void;
  onProfileRequired: (code: string) => void;
  onSignedIn: (result: SignedIn) => void;
}) {
  const [code, setCode] = React.useState("");
  const [resendAt, setResendAt] = React.useState(() => Date.now() + RESEND_COOLDOWN_MS);
  const secondsLeft = useSecondsUntil(resendAt);

  const verify = useMutation({
    mutationFn: verifyOrganizerCode,
    onSuccess: (result, variables) => {
      if (result.status === "PROFILE_REQUIRED") onProfileRequired(variables.code);
      else onSignedIn(result);
    },
  });

  const resend = useMutation({
    mutationFn: requestOrganizerCode,
    onSuccess: () => {
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setCode("");
      verify.reset();
    },
  });

  function submit(value: string) {
    if (value.length === CODE_LENGTH && !verify.isPending) verify.mutate({ email, code: value, profile });
  }

  const error =
    errorText(verify.error, "Could not verify the code.") ?? errorText(resend.error, "Could not resend the code.");

  return (
    <>
      <StepHeader
        title="Enter OTP"
        subtitle={
          <>
            Sent to <span className="font-medium text-ink">{email}</span>{" "}
            <button type="button" onClick={onChangeEmail} className="text-link underline-offset-2 hover:underline">
              Change
            </button>
          </>
        }
      />
      <form
        className="mt-xl flex flex-col gap-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(code);
        }}
      >
        <Label htmlFor="organizer-code" className="sr-only">
          {CODE_LENGTH}-digit code
        </Label>
        <Input
          id="organizer-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH}
          autoFocus
          required
          placeholder={"•".repeat(CODE_LENGTH)}
          value={code}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
            setCode(digits);
            // Submit as soon as the last digit lands (typed, pasted or autofilled).
            if (digits.length === CODE_LENGTH) submit(digits);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "organizer-code-error" : undefined}
          className={cn(FIELD_CLASS, "text-center font-mono text-title-lg tracking-[0.5em] md:text-title-lg")}
        />
        <ErrorMessage id="organizer-code-error" message={error} />
        <Button type="submit" className={BUTTON_CLASS} disabled={code.length < CODE_LENGTH || verify.isPending}>
          {verify.isPending ? "Verifying…" : profile ? "Verify and create account" : "Verify"}
        </Button>
      </form>

      <p className="mt-lg text-center text-body-md text-muted-foreground" aria-live="polite">
        {resend.isSuccess && secondsLeft > 0 ? "A new code is on its way. " : null}
        {secondsLeft > 0 ? (
          <>
            Resend OTP in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </>
        ) : (
          <button
            type="button"
            onClick={() => resend.mutate(email)}
            disabled={resend.isPending}
            className="font-medium text-link underline-offset-2 hover:underline disabled:opacity-60"
          >
            {resend.isPending ? "Sending…" : "Resend OTP"}
          </button>
        )}
      </p>
    </>
  );
}

/** Login with an address that has no account yet: the code is already verified, so just collect the details. */
function ProfileStep({
  email,
  code,
  onStartOver,
  onSignedIn,
}: {
  email: string;
  code: string;
  onStartOver: () => void;
  onSignedIn: (result: SignedIn) => void;
}) {
  const [draft, setDraft] = React.useState<SignupDraft>({ ...EMPTY_DRAFT, email });
  const [formError, setFormError] = React.useState<string | null>(null);
  const update = (patch: Partial<SignupDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const createAccount = useMutation({
    mutationFn: verifyOrganizerCode,
    onSuccess: (result) => {
      if (result.status === "SIGNED_IN") onSignedIn(result);
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!draft.name.trim()) return setFormError("Enter your full name.");
    if (!draft.acceptedTerms || !draft.acceptedPrivacy) {
      return setFormError("Accept the Terms of Service and Privacy Policy to continue.");
    }
    if (!createAccount.isPending) createAccount.mutate({ email, code, profile: toProfile(draft) });
  }

  const error = formError ?? errorText(createAccount.error, "Could not create your account.");
  // The code expired or was locked while the form was open — only a new code helps.
  const needsNewCode = Boolean(createAccount.error) && /new code|Request a new one/i.test(error ?? "");

  return (
    <>
      <StepHeader
        title="Create your organizer account"
        subtitle={
          <>
            There's no organizer account for <span className="font-medium text-ink">{email}</span> yet
          </>
        }
      />
      <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md" noValidate>
        <Label htmlFor="organizer-name" className="sr-only">
          Full name
        </Label>
        <Input
          id="organizer-name"
          autoComplete="name"
          autoFocus
          required
          placeholder="Full name"
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          className={FIELD_CLASS}
        />
        <Label htmlFor="organizer-phone" className="sr-only">
          Phone (optional)
        </Label>
        <Input
          id="organizer-phone"
          type="tel"
          autoComplete="tel"
          placeholder="Phone (optional)"
          value={draft.phone}
          onChange={(event) => update({ phone: event.target.value })}
          className={FIELD_CLASS}
        />
        <ConsentCheckboxes
          acceptedTerms={draft.acceptedTerms}
          acceptedPrivacy={draft.acceptedPrivacy}
          onChange={update}
        />
        <ErrorMessage id="organizer-profile-error" message={error} />
        {needsNewCode ? (
          <Button type="button" className={BUTTON_CLASS} onClick={onStartOver}>
            Get a new code
          </Button>
        ) : (
          <Button type="submit" className={BUTTON_CLASS} disabled={createAccount.isPending}>
            {createAccount.isPending ? "Creating your account…" : "Create account"}
          </Button>
        )}
      </form>
    </>
  );
}
