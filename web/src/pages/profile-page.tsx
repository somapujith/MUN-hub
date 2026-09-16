import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { getAccountSettings, setEmailNotificationsEnabled } from "@/api/account";
import { changePassword } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { completeStudentProfile, getStudentProfile } from "@/api/student-profile";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { cn } from "cn";
import type { StudentProfileInput } from "@/types/student-profile";

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

export function ProfilePage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: STUDENT_PROFILE_QUERY_KEY,
    queryFn: getStudentProfile,
  });
  const [form, setForm] = useState<StudentProfileInput>(EMPTY_FORM);

  // Seeds the form once the existing profile loads. `phone`/`institution`
  // live on `users`, not `student_profiles` — GET /profile doesn't return
  // them, so they aren't pre-filled here (see the report for why that's
  // out of this task's scope).
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    if (accountQuery.data) setNotificationsEnabled(accountQuery.data.emailNotificationsEnabled);
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
        <title>Your profile</title>
      </Helmet>
      <SiteHeader session={session ?? null} />
      <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">
            {hasExistingProfile ? "Your profile" : "Complete your profile"}
          </h1>
          <p className="text-body-md text-muted-foreground">
            We ask for this once so it can pre-fill your MUN registrations — you can update it any
            time.
          </p>
        </header>
        <Separator />
        {profileQuery.isLoading ? (
          <Skeleton className="h-[400px] w-full max-w-lg rounded-md" />
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
            className="flex max-w-lg flex-col gap-lg"
          >
            <Card>
              <CardHeader>
                <CardTitle>Personal details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
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
                <label className="flex items-center gap-sm text-body-md text-body" htmlFor="profile-transportation">
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
                </label>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Emergency contact</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
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
        )}

        <Separator />

        <section className="flex max-w-lg flex-col gap-lg" aria-labelledby="account-security-heading">
          <header className="flex flex-col gap-xxs">
            <h2 id="account-security-heading" className="font-display text-title-lg text-ink">
              Account &amp; security
            </h2>
            <p className="text-body-md text-muted-foreground">
              Manage your password and notification preferences.
            </p>
          </header>

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
                  <label
                    className="flex items-center gap-sm text-body-md text-body"
                    htmlFor="email-notifications"
                  >
                    <Checkbox
                      id="email-notifications"
                      checked={notificationsEnabled}
                      onCheckedChange={(checked) => setNotificationsEnabled(checked === true)}
                    />
                    <Label htmlFor="email-notifications" className="cursor-pointer">
                      Send me email notifications
                    </Label>
                  </label>
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
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
