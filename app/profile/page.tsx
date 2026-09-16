import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Separator } from "@/components/ui/separator";
import { ProfileForm } from "@/components/profile/profile-form";
import { ChangePasswordForm } from "@/components/profile/change-password-form";
import { EmailNotificationsForm } from "@/components/profile/email-notifications-form";
import { getSession } from "@/app/lib/session";
import { safeRedirectTo } from "@/app/login/redirect";
import { getStudentProfile } from "@/lib/actions/student-profile";
import { getAccountSettings } from "@/lib/actions/account";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Your profile",
  description: "The onboarding details MUN Hub uses for every conference registration.",
};

// Session-scoped read — never cache or statically prerender this page, same
// reasoning as app/dashboard/page.tsx.
export const dynamic = "force-dynamic";

interface ProfilePageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const { redirectTo: rawRedirectTo } = await searchParams;
  const redirectTo = safeRedirectTo(rawRedirectTo);

  const session = await getSession();
  if (!session) {
    // Forward this page's own redirectTo through login so post-login lands
    // back on /profile, which then forwards the original destination again.
    const backToProfile = `/profile${redirectTo !== "/" ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""}`;
    redirect(`/login?redirectTo=${encodeURIComponent(backToProfile)}`);
  }

  const [profile, [user], accountSettings] = await Promise.all([
    getStudentProfile(session),
    db
      .select({ phone: users.phone, institution: users.institution })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
    getAccountSettings(session),
  ]);

  const isEdit = profile !== null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-xl px-lg py-xl sm:px-xl">
        <header className="flex flex-col gap-xs border-b border-border pb-lg">
          <h1 className="font-display text-display-md text-ink">
            {isEdit ? "Your profile" : "Complete your profile"}
          </h1>
          <p className="text-body-md text-muted-foreground">
            {isEdit
              ? "Update the details we use to pre-fill every MUN registration you make."
              : "Fill this in once and we'll reuse it for every MUN registration — no more retyping your emergency contact and details at every conference."}
          </p>
        </header>

        <ProfileForm
          redirectTo={redirectTo}
          defaults={{
            phone: user?.phone ?? "",
            institution: user?.institution ?? "",
            dateOfBirth: profile ? profile.dateOfBirth.toISOString().slice(0, 10) : "",
            gradeOrYear: profile?.gradeOrYear ?? "",
            residentialAddress: profile?.residentialAddress ?? "",
            requiresTransportation: profile?.requiresTransportation ?? false,
            emergencyContactName: profile?.emergencyContactName ?? "",
            emergencyContactPhone: profile?.emergencyContactPhone ?? "",
            emergencyContactRelation: profile?.emergencyContactRelation ?? "",
            munExperience: profile?.munExperience ?? "",
            referralCode: profile?.referralCode ?? "",
          }}
        />

        <Separator />

        <section className="flex flex-col gap-lg">
          <div className="flex flex-col gap-xs">
            <h2 className="text-title-lg text-ink">Account & security</h2>
            <p className="text-body-md text-muted-foreground">
              Signed in as {accountSettings.name} ({accountSettings.email})
            </p>
          </div>

          <div className="flex flex-col gap-md">
            <h3 className="text-body-md font-medium text-ink">Change password</h3>
            <ChangePasswordForm />
          </div>

          <div className="flex flex-col gap-md border-t border-border pt-lg">
            <h3 className="text-body-md font-medium text-ink">Notifications</h3>
            <EmailNotificationsForm defaultChecked={accountSettings.emailNotificationsEnabled} />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
