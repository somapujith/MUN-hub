import * as React from "react";
import { Helmet } from "react-helmet-async";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpOrganizer } from "@/api/organizer-auth";
import { queryKeys } from "@/api/query-keys";
import { useSession } from "@/hooks/use-session";

const HERO_IMAGE = "/images/organizer-login.jpg";
const ORGANIZER_SUPPORT_EMAIL = "organizers@munhub.in";
const MIN_PASSWORD_LENGTH = 8;

/**
 * Organizer account creation, on publish.munhub.in. Organizer accounts are
 * separate from delegate accounts by design: this creates an ORGANIZER
 * account directly, asks for nothing a conference host doesn't need (no DOB,
 * grade or emergency contact), and there is no path that turns a delegate
 * account into an organizer one. Applying to host a conference is the next
 * step once the account exists.
 */
export function OrganizerSignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: currentSession } = useSession();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [acceptedTerms, setAcceptedTerms] = React.useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const signUpMutation = useMutation({
    mutationFn: signUpOrganizer,
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), session);
      navigate("/organizer/apply", { replace: true });
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim()) return setFormError("Enter your full name.");
    if (!email.trim()) return setFormError("Enter your email address.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (password !== confirmPassword) return setFormError("Passwords don't match.");
    if (!acceptedTerms || !acceptedPrivacy) {
      return setFormError("Accept the Terms of Service and Privacy Policy to continue.");
    }

    signUpMutation.mutate({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      phone: phone.trim() || undefined,
      acceptedTermsOfService: acceptedTerms,
      acceptedPrivacyPolicy: acceptedPrivacy,
    });
  }

  // Already an organizer: nothing to create. Skipped while this page's own
  // signup is completing — onSuccess seeds an ORGANIZER session and sends the
  // new account to /organizer/apply instead.
  if (currentSession?.role === "ORGANIZER" && signUpMutation.isIdle) {
    return <Navigate to="/organizer/dashboard" replace />;
  }

  const errorMessage =
    formError ??
    (signUpMutation.isError
      ? signUpMutation.error instanceof Error
        ? signUpMutation.error.message
        : "Could not create your account."
      : null);

  return (
    <>
      <Helmet>
        <title>Create an organizer account | MUN Hub</title>
        <meta
          name="description"
          content="Create a MUN Hub organizer account to publish your Model UN conference."
        />
      </Helmet>

      <AuthSplitLayout
        imageSrc={HERO_IMAGE}
        headline="Your MUN, in front of every delegate"
        subtext="Publish your MUN on MUN Hub and reach students across the country looking for their next committee — every single day."
        footer={
          <>
            In case of any queries, reach out to{" "}
            <a href={`mailto:${ORGANIZER_SUPPORT_EMAIL}`} className="text-link underline-offset-2 hover:underline">
              {ORGANIZER_SUPPORT_EMAIL}
            </a>
          </>
        }
      >
        <div className="w-full max-w-[400px]">
          <header className="flex flex-col items-center gap-xs text-center">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">Create an organizer account</h1>
            <p className="text-body-md text-muted-foreground">to publish your MUN</p>
          </header>

          <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md" noValidate>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="org-name" className="sr-only">
                Full name
              </Label>
              <Input
                id="org-name"
                autoComplete="name"
                autoFocus
                required
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="org-email" className="sr-only">
                Email address
              </Label>
              <Input
                id="org-email"
                type="email"
                autoComplete="email"
                required
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="org-phone" className="sr-only">
                Phone (optional)
              </Label>
              <Input
                id="org-phone"
                type="tel"
                autoComplete="tel"
                placeholder="Phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="org-password" className="sr-only">
                Password
              </Label>
              <Input
                id="org-password"
                type="password"
                autoComplete="new-password"
                required
                placeholder={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="org-confirm" className="sr-only">
                Confirm password
              </Label>
              <Input
                id="org-confirm"
                type="password"
                autoComplete="new-password"
                required
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {/* A plain div, not a wrapping <label>: <Label> already renders a
                label element, and labels can't nest. */}
            <div className="flex items-start gap-sm">
              <Checkbox
                id="org-terms"
                checked={acceptedTerms}
                onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
              />
              {/* TODO: link the policy text once /legal/terms ships (same as the delegate signup). */}
              <Label htmlFor="org-terms" className="cursor-pointer text-body-md font-normal text-body">
                I agree to the Terms of Service
              </Label>
            </div>
            <div className="flex items-start gap-sm">
              <Checkbox
                id="org-privacy"
                checked={acceptedPrivacy}
                onCheckedChange={(checked) => setAcceptedPrivacy(checked === true)}
              />
              <Label htmlFor="org-privacy" className="cursor-pointer text-body-md font-normal text-body">
                I agree to the Privacy Policy
              </Label>
            </div>

            {errorMessage ? (
              <p
                role="alert"
                className="rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text"
              >
                {errorMessage}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={signUpMutation.isPending}>
              {signUpMutation.isPending ? "Creating your account…" : "Create account"}
            </Button>
          </form>

          <div className="mt-lg flex flex-col gap-md">
            <div className="flex items-center gap-sm" role="separator" aria-label="or">
              <span className="h-px flex-1 bg-border" />
              <span className="text-caption uppercase text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="outline" className="w-full" render={<Link to="/organizer/login" />}>
              Already have an organizer account? Log in
            </Button>
          </div>
        </div>
      </AuthSplitLayout>
    </>
  );
}
