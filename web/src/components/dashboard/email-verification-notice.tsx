import { useMutation } from "@tanstack/react-query";
import { MailCheckIcon, MailIcon } from "lucide-react";
import { Link } from "react-router";
import { resendVerificationEmail } from "@/api/email-verification";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

interface EmailVerificationNoticeProps {
  email: string;
  /** Registration is blocked until the address is verified (server REQUIRE_EMAIL_VERIFICATION). */
  required: boolean;
  /** Short copy for a freshly created account ("we just sent…"). */
  justSignedUp?: boolean;
  /** `block` replaces a flow the account can't use yet (the registration funnel). */
  variant?: "banner" | "block";
  className?: string;
}

/**
 * "Verify your email" prompt for a delegate whose address isn't confirmed yet,
 * with a one-click resend (POST /verify-email/resend) so the link is never
 * more than a click away. The resend endpoint answers the same way whether or
 * not the address has an account, so success copy never claims more than it
 * knows.
 */
export function EmailVerificationNotice({
  email,
  required,
  justSignedUp = false,
  variant = "banner",
  className,
}: EmailVerificationNoticeProps) {
  const resend = useMutation({ mutationFn: () => resendVerificationEmail(email) });

  const title = justSignedUp
    ? "Check your inbox to verify your email"
    : variant === "block"
      ? "Verify your email to register"
      : "Verify your email address";
  const lead = justSignedUp
    ? `Your account is ready. We sent a verification link to ${email}.`
    : `We sent a verification link to ${email}.`;
  const consequence = required
    ? " You'll need to open it before you can register for a conference."
    : " Opening it confirms we can reach you about your registrations.";

  return (
    <section
      aria-labelledby="verify-email-notice-title"
      className={cn(
        "flex flex-col gap-md rounded-md border border-warning/40 bg-warning/12",
        variant === "block" ? "p-lg sm:p-xl" : "p-md sm:p-lg",
        className,
      )}
    >
      <div className="flex items-start gap-sm">
        <MailIcon className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden />
        <div className="flex flex-col gap-xxs">
          <h2
            id="verify-email-notice-title"
            className={cn(
              "font-display text-warning-text",
              variant === "block" ? "text-title-lg" : "text-title-sm",
            )}
          >
            {title}
          </h2>
          <p className="max-w-prose text-body-md text-body">
            {lead}
            {consequence} The link works for 24 hours — check your spam folder if you can&apos;t find it.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-sm">
        <Button
          size="sm"
          variant={variant === "block" ? "default" : "outline"}
          disabled={resend.isPending || resend.isSuccess}
          onClick={() => resend.mutate()}
        >
          {resend.isSuccess ? <MailCheckIcon aria-hidden /> : null}
          {resend.isPending ? "Sending…" : resend.isSuccess ? "Email sent" : "Resend verification email"}
        </Button>
        {variant === "block" && (
          <Button size="sm" variant="outline" render={<Link to="/verify-email" />}>
            Use a different email
          </Button>
        )}
      </div>
      <p aria-live="polite" className="text-body-md text-muted-foreground empty:hidden">
        {resend.isSuccess
          ? `A fresh link is on its way to ${email}. Earlier links no longer work.`
          : resend.isError
            ? resend.error instanceof Error
              ? resend.error.message
              : "We couldn't send the email. Try again in a minute."
            : ""}
      </p>
    </section>
  );
}
