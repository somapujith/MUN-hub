import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { OrganizerOtpForm } from "@/components/auth/organizer-otp-form";

/** Hero photo for both organizer auth pages; the layout falls back to a gradient if it fails to load. */
const HERO_IMAGE = "/images/organizer-login.jpg";
const ORGANIZER_SUPPORT_EMAIL = "organizers@munhub.in";

/** The shared frame for publish.munhub.in's sign-in and sign-up pages. */
export function OrganizerAuthLayout({ children }: { children: ReactNode }) {
  return (
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
      {children}
    </AuthSplitLayout>
  );
}

/**
 * The organizer door — the landing page of publish.munhub.in. Passwordless:
 * email, then an emailed one-time code. Organizer accounts are separate from
 * delegate accounts; a delegate address never receives a code here.
 */
export function OrganizerLoginPage() {
  return (
    <>
      <Helmet>
        <title>Organizer log in | MUN Hub</title>
        <meta
          name="description"
          content="Log in to publish your Model UN conference on MUN Hub and manage delegates, registrations and payments."
        />
      </Helmet>
      <OrganizerAuthLayout>
        <OrganizerOtpForm mode="login" />
      </OrganizerAuthLayout>
    </>
  );
}
