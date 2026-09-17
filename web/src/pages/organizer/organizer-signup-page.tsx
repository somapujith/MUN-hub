import { Helmet } from "react-helmet-async";
import { OrganizerOtpForm } from "@/components/auth/organizer-otp-form";
import { OrganizerAuthLayout } from "@/pages/organizer/organizer-login-page";

/**
 * Organizer account creation on publish.munhub.in. The organizer fills in
 * their details first, then confirms their email with a one-time code; the
 * account is created only once the code checks out. No password, no delegate
 * profile fields, and no path that turns a delegate account into this one.
 */
export function OrganizerSignupPage() {
  return (
    <>
      <Helmet>
        <title>Create an organizer account | MUN Hub</title>
        <meta name="description" content="Create a MUN Hub organizer account to publish your Model UN conference." />
      </Helmet>
      <OrganizerAuthLayout>
        <OrganizerOtpForm mode="signup" />
      </OrganizerAuthLayout>
    </>
  );
}
