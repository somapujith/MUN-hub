import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";
import { LockIcon, ShieldIcon, UserIcon, type LucideIcon } from "lucide-react";
import { getAccountSettings, setEmailNotificationsEnabled } from "@/api/account";
import { changePassword } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { completeStudentProfile, getStudentProfile } from "@/api/student-profile";
import { PrivacyDataSection } from "@/components/account/privacy-data-section";
import { EmailVerificationNotice } from "@/components/dashboard/email-verification-notice";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useScrollFadeRef } from "@/hooks/use-scroll-fade";
import { cn } from "cn";
import type { StudentProfileInput } from "@/types/student-profile";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

const EMPTY_PASSWORD_FORM = { currentPassword: "", newPassword: "", confirmPassword: "" };
const MIN_PASSWORD_LENGTH = 8;

/**
 * Not shared via web/src/api/query-keys.ts — that file is being edited
 * concurrently by several sibling feature slices right now (observed
 * mid-session); keeping this task's cache key local avoids racing those
 * edits. A later pass can fold it in centrally.
 */
const STUDENT_PROFILE_QUERY_KEY = ["student-profile"] as const;

const EMPTY_FORM: StudentProfileInput = {
  phone: "",
  institution: "",
  dateOfBirth: "",
  gradeOrYear: "",
  residentialAddress: "",
  requiresTransportation: false,
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelation: "",
  munExperience: "",
  referralCode: "",
};

const textareaClassName = cn(
  "w-full resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
);

/**
 * Personal/Emergency/Additional stay grouped under one "Profile details" tab
 * rather than three separate ones: they're a single `StudentProfileInput`
 * saved by one `completeStudentProfile` call, and splitting them across tabs
 * would silently unmount a tab's `required` fields from the DOM — native
 * HTML validation only sees whatever tab is currently rendered, so an unseen
 * required field could submit empty. Security and privacy are genuinely
 * independent actions, so they get their own tabs.
 */
const PROFILE_SECTIONS: ReadonlyArray<{ key: string; label: string; description: string; icon: LucideIcon }> = [
  { key: "profile", label: "Profile details", description: "Contact info, school, and emergency contact", icon: UserIcon },
  { key: "security", label: "Account & security", description: "Password and email notifications", icon: LockIcon },
  { key: "privacy", label: "Privacy & data", description: "Export or delete your account", icon: ShieldIcon },
];
const DEFAULT_SECTION = PROFILE_SECTIONS[0].key;

function sectionMeta(key: string) {
  return PROFILE_SECTIONS.find((section) => section.key === key)!;
}

/**
 * Every tab panel opens with the same {h2 + one-line description} shape —
 * the pattern `PrivacyDataSection` already established for its own panel.
 * Reusing it here (instead of jumping straight into the first card) is what
 * gives the three panels equal visual rhythm; the copy itself is just the
 * matching `PROFILE_SECTIONS` entry, not new copy.
 */
function SectionIntro({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <header className="flex flex-col gap-xxs">
      <h2 id={id} className="font-display text-title-lg text-ink">
        {title}
      </h2>
      <p className="text-body-md text-muted-foreground">{description}.</p>
    </header>
  );
}

const NAV_ITEM_BASE =
  "group/nav flex items-start gap-sm rounded-sm px-sm py-sm text-left outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const NAV_ITEM_IDLE = "text-muted-foreground hover:bg-surface-soft hover:text-ink";
const NAV_ITEM_ACTIVE = "relative bg-surface-soft text-ink before:absolute before:inset-y-2 before:-left-px before:w-[3px] before:rounded-pill before:bg-primary before:content-['']";

export function ProfilePage() {
  useScrollToTop();
  const queryClient = useQueryClient();
  const mobileSectionNavRef = useScrollFadeRef<HTMLElement>("x");
  // Set by the signup page (router state, so the URL stays /profile): the
  // account was just created, and the copy says so instead of leaving the
  // delegate wondering whether anything happened.
  const location = useLocation();
  const justSignedUp = (location.state as { justSignedUp?: boolean } | null)?.justSignedUp === true;

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const activeSection = PROFILE_SECTIONS.some((s) => s.key === requestedSection) ? requestedSection! : DEFAULT_SECTION;

  function selectSection(key: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("section", key);
      return next;
    });
  }

  const profileQuery = useQuery({
    queryKey: STUDENT_PROFILE_QUERY_KEY,
    queryFn: getStudentProfile,
  });
  const [form, setForm] = useState<StudentProfileInput>(EMPTY_FORM);

  // Seeds the form once the existing profile loads. `phone`/`institution`
  // live on `users`, not `student_profiles`, so they're seeded separately
  // from GET /account below.
  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    setForm((prev) => ({
      ...prev,
      dateOfBirth: profile.dateOfBirth.slice(0, 10),
      gradeOrYear: profile.gradeOrYear,
      residentialAddress: profile.residentialAddress,
      requiresTransportation: profile.requiresTransportation,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactPhone: profile.emergencyContactPhone,
      emergencyContactRelation: profile.emergencyContactRelation,
      munExperience: profile.munExperience ?? "",
      referralCode: profile.referralCode ?? "",
    }));
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: StudentProfileInput) => completeStudentProfile(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STUDENT_PROFILE_QUERY_KEY });
      toast.success("Profile saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save profile"),
  });

  const hasExistingProfile = Boolean(profileQuery.data);

  // ---- Account & security (independent section, own queries/mutations —
  // it does not share the profile form's save button or validation). ----
  const accountQuery = useQuery({
    queryKey: queryKeys.account(),
    queryFn: getAccountSettings,
  });
  const account = accountQuery.data;
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    const account = accountQuery.data;
    if (!account) return;
    setNotificationsEnabled(account.emailNotificationsEnabled);
    // Pre-fill phone/institution (captured at signup, stored on `users`)
    // without overwriting anything the student has already typed.
    setForm((prev) => ({
      ...prev,
      phone: prev.phone || account.phone || "",
      institution: prev.institution || account.institution || "",
    }));
  }, [accountQuery.data]);

  const notificationsMutation = useMutation({
    mutationFn: (next: boolean) => setEmailNotificationsEnabled(next),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.account() });
      toast.success("Preference saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save preference"),
  });

  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const changePasswordMutation = useMutation({
    mutationFn: () => changePassword(passwordForm.currentPassword, passwordForm.newPassword),
    onSuccess: () => {
      setPasswordForm(EMPTY_PASSWORD_FORM);
      toast.success("Password changed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to change password"),
  });

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    if (passwordForm.newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    changePasswordMutation.mutate();
  }

  const notificationsDirty = accountQuery.data
    ? notificationsEnabled !== accountQuery.data.emailNotificationsEnabled
    : false;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Your profile | MUN Hub</title>
      </Helmet>
      <SiteHeader />
      <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">
            {hasExistingProfile ? "Your profile" : "Complete your profile"}
          </h1>
          <p className="text-body-md text-muted-foreground">
            {account ? (
              <>
                Signed in as {account.name} ({account.email}).{" "}
              </>
            ) : null}
            We ask for this once so it can pre-fill your MUN registrations — you can update it any
            time.
          </p>
        </header>
        {justSignedUp && account?.emailVerified ? (
          <p
            role="status"
            className="rounded-md border border-success/30 bg-success/8 px-md py-sm text-body-md text-success-text"
          >
            Your account is ready. Browse conferences whenever you are —{" "}
            <Link to="/muns" className="underline underline-offset-2">
              find a MUN
            </Link>
            .
          </p>
        ) : null}
        {account && !account.emailVerified ? (
          <EmailVerificationNotice
            email={account.email}
            required={account.emailVerificationRequired}
            justSignedUp={justSignedUp}
            className="max-w-3xl"
          />
        ) : null}

        <div className="grid gap-xl lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
          {/* Mobile: horizontal scrollable pill row. Desktop: vertical sidebar (see lg:hidden / hidden lg:flex below). */}
          <nav
            ref={mobileSectionNavRef}
            aria-label="Profile sections"
            className="flex gap-xs overflow-x-auto pb-xxs lg:hidden"
          >
            {PROFILE_SECTIONS.map((section) => {
              const active = section.key === activeSection;
              const Icon = section.icon;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => selectSection(section.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-xs rounded-pill border px-md py-xs text-body-md whitespace-nowrap outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active
                      ? "border-primary bg-primary/8 font-medium text-ink"
                      : "border-border text-muted-foreground hover:text-ink",
                  )}
                >
                  <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
                  {section.label}
                </button>
              );
            })}
          </nav>
          <nav aria-label="Profile sections" className="sticky top-lg hidden flex-col gap-px lg:flex">
            {PROFILE_SECTIONS.map((section) => {
              const active = section.key === activeSection;
              const Icon = section.icon;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => selectSection(section.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(NAV_ITEM_BASE, active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE)}
                >
                  <Icon
                    aria-hidden
                    strokeWidth={1.75}
                    className={cn("mt-px size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                  />
                  <span className="flex flex-col gap-[1px]">
                    <span className="text-body-md font-medium">{section.label}</span>
                    <span className="text-body-sm text-muted-foreground">{section.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-w-0 flex-col gap-lg">
            {activeSection === "profile" &&
              (profileQuery.isLoading ? (
                <Skeleton className="h-[400px] w-full rounded-md" />
              ) : profileQuery.isError ? (
                <p className="text-body-md text-destructive">{profileQuery.error.message}</p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveMutation.mutate({
                      ...form,
                      munExperience: form.munExperience?.trim() || undefined,
                      referralCode: form.referralCode?.trim() || undefined,
                    });
                  }}
                  className="flex flex-col gap-lg"
                >
                  <SectionIntro
                    id="profile-details-heading"
                    title={sectionMeta("profile").label}
                    description={sectionMeta("profile").description}
                  />
                  <Card>
                    <CardHeader>
                      <CardTitle>Personal details</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-md">
                      <div className="grid gap-md sm:grid-cols-2">
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-phone">Phone number</Label>
                          <Input
                            id="profile-phone"
                            type="tel"
                            value={form.phone}
                            onChange={(e) => setForm({ ...form, phone: e.target.value })}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-institution">School or institution</Label>
                          <Input
                            id="profile-institution"
                            value={form.institution}
                            onChange={(e) => setForm({ ...form, institution: e.target.value })}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-dob">Date of birth</Label>
                          <Input
                            id="profile-dob"
                            type="date"
                            value={form.dateOfBirth}
                            onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-grade">Grade / year</Label>
                          <Input
                            id="profile-grade"
                            value={form.gradeOrYear}
                            onChange={(e) => setForm({ ...form, gradeOrYear: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="profile-address">Residential address</Label>
                        <textarea
                          id="profile-address"
                          rows={3}
                          className={textareaClassName}
                          value={form.residentialAddress}
                          onChange={(e) => setForm({ ...form, residentialAddress: e.target.value })}
                          required
                        />
                      </div>
                      <div className="flex items-center gap-sm">
                        <Checkbox
                          id="profile-transportation"
                          checked={form.requiresTransportation}
                          onCheckedChange={(checked) =>
                            setForm({ ...form, requiresTransportation: checked === true })
                          }
                        />
                        <Label htmlFor="profile-transportation" className="cursor-pointer">
                          I&apos;ll need transportation assistance
                        </Label>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Emergency contact</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-md">
                      <div className="grid gap-md sm:grid-cols-3">
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-ec-name">Name</Label>
                          <Input
                            id="profile-ec-name"
                            value={form.emergencyContactName}
                            onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-ec-phone">Phone</Label>
                          <Input
                            id="profile-ec-phone"
                            type="tel"
                            value={form.emergencyContactPhone}
                            onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <Label htmlFor="profile-ec-relation">Relation</Label>
                          <Input
                            id="profile-ec-relation"
                            value={form.emergencyContactRelation}
                            onChange={(e) => setForm({ ...form, emergencyContactRelation: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Additional (optional)</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-md">
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="profile-experience">Prior MUN experience</Label>
                        <textarea
                          id="profile-experience"
                          rows={3}
                          className={textareaClassName}
                          value={form.munExperience ?? ""}
                          onChange={(e) => setForm({ ...form, munExperience: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="profile-referral">Referral code</Label>
                        <Input
                          id="profile-referral"
                          value={form.referralCode ?? ""}
                          onChange={(e) => setForm({ ...form, referralCode: e.target.value })}
                        />
                      </div>
                    </CardContent>
                  </Card>
                  <Button type="submit" className="self-start" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : "Save profile"}
                  </Button>
                </form>
              ))}

            {activeSection === "security" && (
              <div className="flex flex-col gap-lg">
                <SectionIntro
                  id="account-security-heading"
                  title={sectionMeta("security").label}
                  description={sectionMeta("security").description}
                />
                <Card>
                  <CardHeader>
                    <CardTitle>Change password</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-md">
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="current-password">Current password</Label>
                        <Input
                          id="current-password"
                          type="password"
                          autoComplete="current-password"
                          value={passwordForm.currentPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="new-password">New password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={MIN_PASSWORD_LENGTH}
                          value={passwordForm.newPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="confirm-new-password">Confirm new password</Label>
                        <Input
                          id="confirm-new-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={MIN_PASSWORD_LENGTH}
                          value={passwordForm.confirmPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                          required
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        className="self-start"
                        disabled={changePasswordMutation.isPending}
                      >
                        {changePasswordMutation.isPending ? "Changing..." : "Change password"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Email notifications</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-md">
                    {accountQuery.isLoading ? (
                      <Skeleton className="h-6 w-48 rounded-sm" />
                    ) : accountQuery.isError ? (
                      <p className="text-body-md text-destructive">{accountQuery.error.message}</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-sm">
                          <Checkbox
                            id="email-notifications"
                            checked={notificationsEnabled}
                            onCheckedChange={(checked) => setNotificationsEnabled(checked === true)}
                          />
                          <Label htmlFor="email-notifications" className="cursor-pointer">
                            Send me email notifications
                          </Label>
                        </div>
                        <Button
                          size="sm"
                          className="self-start"
                          disabled={!notificationsDirty || notificationsMutation.isPending}
                          onClick={() => notificationsMutation.mutate(notificationsEnabled)}
                        >
                          {notificationsMutation.isPending ? "Saving..." : "Save preference"}
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeSection === "privacy" && <PrivacyDataSection />}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
