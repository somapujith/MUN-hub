import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { LoginForm } from "@/components/auth/login-form";
import { Button } from "@/components/ui/button";

/** Drop the photo at web/public/images/organizer-login.jpg — the layout falls back to a gradient until then. */
const HERO_IMAGE = "/images/organizer-login.jpg";
const ORGANIZER_SUPPORT_EMAIL = "organizers@munhub.in";

/**
 * The organizer door — the landing page of publish.munhub.in. Same credential
 * endpoint as `/login`; the difference is signposting and destination
 * (straight into the organizer workspace). A delegate who signs in here isn't
 * rejected; the form shows them where they belong instead.
 */
export function OrganizerLoginPage() {
  return (
    <>
      <Helmet>
        <title>Organizer sign in | MUN Hub</title>
        <meta
          name="description"
          content="Sign in to publish your Model UN conference on MUN Hub and manage delegates, registrations and payments."
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
        <LoginForm
          door={{
            title: "Log in or sign up",
            subtitle: "to publish your MUN",
            expectedRoles: ["ORGANIZER"],
            variant: "centered",
            submitLabel: "Log in",
            afterForm: (
              <div className="flex flex-col gap-md">
                <div className="flex items-center gap-sm" role="separator" aria-label="or">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-caption uppercase text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  render={<Link to={`/signup?redirectTo=${encodeURIComponent("/organizer/apply")}`} />}
                >
                  New organizer? Create an account
                </Button>
                <p className="text-center text-body-md text-muted-foreground">
                  Then tell us about your conference — we review applications within 5 business days.
                </p>
              </div>
            ),
          }}
        />
      </AuthSplitLayout>
    </>
  );
}
