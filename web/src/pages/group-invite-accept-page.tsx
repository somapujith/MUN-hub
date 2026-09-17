import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, UsersRound } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import {
  CORE_KEYS,
  CORE_LABELS,
  DynamicField,
  isFieldVisible,
} from "@/components/registration/dynamic-field";
import { queryKeys } from "@/api/query-keys";
import { getMunBySlug } from "@/api/marketplace";
import { getAccountSettings } from "@/api/account";
import { getProfileFormDefaults } from "@/api/student-profile";
import { acceptGroupInvitation, fetchInvitationPreview } from "@/api/registration-group";
import { useSession } from "@/hooks/use-session";
import { NotFoundPage } from "@/pages/not-found-page";

/**
 * Landing page for a group/delegation invitation link
 * (`${appUrl}/group-invite?token=...`, built in
 * lib/actions/registration-group.ts's buildInviteEmail). Token-consuming page
 * pattern mirrors reset-password-page.tsx / verify-email-page.tsx: a public
 * preview first, then the actual action once signed in.
 *
 * Once accepted, the invitee fills in the SAME per-mun custom registration
 * questions a solo delegate answers — same `DynamicField` rendering
 * registration-form.tsx uses (shared via components/registration/dynamic-field.tsx)
 * — but there is no pass-selection step (the seat is already fixed) and no
 * payment step (the team already paid), so this is its own small funnel
 * rather than mounting `<RegistrationForm>` itself, which is built around
 * those two steps.
 */
export function GroupInviteAcceptPage() {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [core, setCore] = React.useState({ fullName: "", email: "", phone: "" });
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const coreSeeded = React.useRef(false);

  const previewQuery = useQuery({
    queryKey: queryKeys.groupInvitationPreview(token),
    queryFn: () => fetchInvitationPreview(token),
    enabled: token !== "",
    retry: false,
  });

  const munQuery = useQuery({
    queryKey: queryKeys.mun(previewQuery.data?.munSlug ?? ""),
    queryFn: () => getMunBySlug(previewQuery.data!.munSlug),
    enabled: Boolean(previewQuery.data?.munSlug) && previewQuery.data?.status === "PENDING",
  });

  const accountQuery = useQuery({
    queryKey: queryKeys.account(),
    queryFn: getAccountSettings,
    enabled: Boolean(session?.userId),
  });

  const profileDefaultsQuery = useQuery({
    queryKey: queryKeys.profileFormDefaults(),
    queryFn: getProfileFormDefaults,
    enabled: Boolean(session?.userId),
  });

  const orderedFields = React.useMemo(
    () => [...(munQuery.data?.formFields ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [munQuery.data],
  );

  // Waits on every one of these queries itself, not just `accountQuery.data`
  // — this effect runs on every render (it sits above this component's early
  // returns), and `accountQuery` can resolve before `munQuery`/
  // `profileDefaultsQuery` do, which would otherwise lock `coreSeeded` with
  // an empty `orderedFields` and leave every custom field blank forever (see
  // the identical bug fixed in group-register-page.tsx).
  const readyToSeed = Boolean(munQuery.data) && !accountQuery.isLoading && !profileDefaultsQuery.isLoading;
  React.useEffect(() => {
    if (coreSeeded.current || !readyToSeed || !accountQuery.data) return;
    coreSeeded.current = true;
    setCore({ fullName: accountQuery.data.name, email: accountQuery.data.email, phone: accountQuery.data.phone ?? "" });
    const defaults = profileDefaultsQuery.data ?? {};
    setAnswers(Object.fromEntries(orderedFields.map((f) => [f.fieldKey, defaults[f.fieldKey] ?? ""])));
  }, [accountQuery.data, orderedFields, profileDefaultsQuery.data, readyToSeed]);

  if (!token) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl">
          <RegistrationNotice tone="error" title="Invalid invitation link" message="This link is missing its invitation token.">
            <Button render={<Link to="/" />}>Go home</Button>
          </RegistrationNotice>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (previewQuery.isPending) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-lg py-xxl" aria-busy="true" />
        <SiteFooter />
      </div>
    );
  }
  if (previewQuery.isError || !previewQuery.data) return <NotFoundPage />;

  const preview = previewQuery.data;
  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>{`Team invitation — ${preview.munName} | MUN Hub`}</title>
      </Helmet>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        <header className="flex flex-col items-start gap-xs">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand/15 text-brand" aria-hidden>
            <UsersRound strokeWidth={1.75} className="size-6" />
          </span>
          <h1 className="font-display text-title-lg text-ink md:text-display-md">{preview.headName}'s team</h1>
          <p className="text-body-md text-muted-foreground">
            {preview.headName} invited you to join their team for <strong className="text-ink">{preview.munName}</strong> —
            registering as {preview.productName}. Already paid for — nothing for you to pay.
          </p>
        </header>
        {children}
      </main>
      <SiteFooter />
    </div>
  );

  if (preview.status === "ACCEPTED") {
    return shell(
      <RegistrationNotice tone="success" title="Already accepted" message="This invitation has already been used.">
        <Button render={<Link to="/dashboard" />}>Your dashboard</Button>
      </RegistrationNotice>,
    );
  }
  if (preview.status === "EXPIRED" || preview.status === "CANCELLED") {
    return shell(
      <RegistrationNotice
        tone="warning"
        title={preview.status === "EXPIRED" ? "This invitation has expired" : "This invitation was cancelled"}
        message={`Ask ${preview.headName} to send you a fresh invitation.`}
      />,
    );
  }

  if (!session) {
    const redirectTo = encodeURIComponent(`/group-invite?token=${token}`);
    return shell(
      <RegistrationNotice
        tone="neutral"
        title="Sign in to accept"
        message={`Sign in (or create an account with ${preview.invitedEmail}) to accept and fill in your delegate details.`}
      >
        <Button render={<Link to={`/login?redirectTo=${redirectTo}`} />}>Sign in</Button>
        <Button variant="outline" render={<Link to={`/signup?redirectTo=${redirectTo}`} />}>
          Create an account
        </Button>
      </RegistrationNotice>,
    );
  }

  if (munQuery.isPending || accountQuery.isLoading) {
    return shell(<div aria-busy="true" className="py-xxl" />);
  }
  if (!munQuery.data) return <NotFoundPage />;

  const visibleFields = orderedFields.filter((f) => isFieldVisible(f, answers));
  const detailsComplete =
    core.fullName.trim() !== "" &&
    core.email.trim() !== "" &&
    visibleFields.every((f) => !f.required || (answers[f.fieldKey] ?? "").trim() !== "");

  async function handleAccept() {
    if (!detailsComplete) {
      setShowErrors(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { munSlug } = await acceptGroupInvitation(token, {
        ...core,
        ...Object.fromEntries(visibleFields.map((f) => [f.fieldKey, answers[f.fieldKey] ?? ""])),
      });
      navigate(`/mun/${munSlug}?joined=team`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept this invitation. Try again.");
      setPending(false);
    }
  }

  return shell(
    <div className="flex flex-col gap-lg">
      <div>
        <h2 className="text-title-lg text-ink">Your delegate details</h2>
        <p className="text-body-md text-muted-foreground">These reach the organizing team with your registration.</p>
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
              aria-invalid={(showErrors && key !== "phone" && !core[key].trim()) || undefined}
            />
            {showErrors && key !== "phone" && !core[key].trim() && (
              <p className="text-body-md text-destructive-text">{CORE_LABELS[key]} is required.</p>
            )}
          </div>
        ))}
        {visibleFields.map((field) => (
          <DynamicField
            key={field.id}
            field={field}
            value={answers[field.fieldKey] ?? ""}
            onChange={(next) => setAnswers((current) => ({ ...current, [field.fieldKey]: next }))}
            showError={showErrors}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={handleAccept} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
          {pending ? "Joining the team…" : "Accept and join the team"}
        </Button>
      </div>
    </div>,
  );
}
