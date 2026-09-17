import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useSearchParams } from "react-router";
import { signUp } from "@/api/auth";
import type { SignUpInput } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { safeRedirectTo } from "@/lib/redirect";

// Mirrors lib/actions/auth.ts's MIN_PASSWORD_LENGTH — checked client-side for
// fast feedback, but the server re-validates regardless.
const MIN_PASSWORD_LENGTH = 8;

const textareaClassName = cn(
  "w-full resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
);

// Everything the form collects, including account fields the mutation
// doesn't take directly (confirmPassword) and the two array fields kept as
// plain comma-separated strings here — split into arrays only at submit
// time, matching docs/prd/MUNHub_User_Workflow_PRD.md §14's "Areas of
// Interest"/"Languages" without building a dedicated tag-input control.
interface FormState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  gender: string;
  preferredName: string;
  nationality: string;
  dateOfBirth: string;
  phone: string;
  alternateMobile: string;
  residentialAddress: string;
  addressCity: string;
  addressState: string;
  addressCountry: string;
  postalCode: string;
  requiresTransportation: boolean;
  institution: string;
  gradeOrYear: string;
  courseOrProgram: string;
  graduationYear: string;
  department: string;
  studentId: string;
  academicEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  alternateEmergencyContactName: string;
  alternateEmergencyContactNumber: string;
  alternateEmergencyContactRelation: string;
  hasPriorMunExperience: boolean;
  munsAttendedCount: string;
  munExperience: string;
  previousAchievements: string;
  bio: string;
  areasOfInterest: string;
  languages: string;
  isPublicProfileVisible: boolean;
  referralCode: string;
  acceptedTermsOfService: boolean;
  acceptedPrivacyPolicy: boolean;
  acceptedGuardianAcknowledgement: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  gender: "",
  preferredName: "",
  nationality: "",
  dateOfBirth: "",
  phone: "",
  alternateMobile: "",
  residentialAddress: "",
  addressCity: "",
  addressState: "",
  addressCountry: "",
  postalCode: "",
  requiresTransportation: false,
  institution: "",
  gradeOrYear: "",
  courseOrProgram: "",
  graduationYear: "",
  department: "",
  studentId: "",
  academicEmail: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelation: "",
  alternateEmergencyContactName: "",
  alternateEmergencyContactNumber: "",
  alternateEmergencyContactRelation: "",
  hasPriorMunExperience: false,
  munsAttendedCount: "",
  munExperience: "",
  previousAchievements: "",
  bio: "",
  areasOfInterest: "",
  languages: "",
  isPublicProfileVisible: false,
  referralCode: "",
  acceptedTermsOfService: false,
  acceptedPrivacyPolicy: false,
  acceptedGuardianAcknowledgement: false,
};

function splitList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function toSignUpInput(form: FormState): SignUpInput {
  return {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    password: form.password,
    gender: form.gender,
    phone: form.phone.trim(),
    institution: form.institution.trim(),
    dateOfBirth: form.dateOfBirth,
    gradeOrYear: form.gradeOrYear.trim(),
    residentialAddress: form.residentialAddress.trim(),
    requiresTransportation: form.requiresTransportation,
    emergencyContactName: form.emergencyContactName.trim(),
    emergencyContactPhone: form.emergencyContactPhone.trim(),
    emergencyContactRelation: form.emergencyContactRelation.trim(),
    acceptedTermsOfService: form.acceptedTermsOfService,
    acceptedPrivacyPolicy: form.acceptedPrivacyPolicy,
    acceptedGuardianAcknowledgement: form.acceptedGuardianAcknowledgement || undefined,
    munExperience: form.munExperience.trim() || undefined,
    referralCode: form.referralCode.trim() || undefined,
    preferredName: form.preferredName.trim() || undefined,
    nationality: form.nationality.trim() || undefined,
    addressCity: form.addressCity.trim() || undefined,
    addressState: form.addressState.trim() || undefined,
    addressCountry: form.addressCountry.trim() || undefined,
    postalCode: form.postalCode.trim() || undefined,
    alternateMobile: form.alternateMobile.trim() || undefined,
    courseOrProgram: form.courseOrProgram.trim() || undefined,
    graduationYear: form.graduationYear.trim() ? Number(form.graduationYear) : undefined,
    department: form.department.trim() || undefined,
    studentId: form.studentId.trim() || undefined,
    academicEmail: form.academicEmail.trim() || undefined,
    alternateEmergencyContactName: form.alternateEmergencyContactName.trim() || undefined,
    alternateEmergencyContactNumber: form.alternateEmergencyContactNumber.trim() || undefined,
    alternateEmergencyContactRelation: form.alternateEmergencyContactRelation.trim() || undefined,
    hasPriorMunExperience: form.hasPriorMunExperience,
    munsAttendedCount: form.munsAttendedCount.trim() ? Number(form.munsAttendedCount) : undefined,
    previousAchievements: form.previousAchievements.trim() || undefined,
    bio: form.bio.trim() || undefined,
    areasOfInterest: splitList(form.areasOfInterest),
    languages: splitList(form.languages),
    isPublicProfileVisible: form.isPublicProfileVisible,
  };
}

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const signUpMutation = useMutation({
    mutationFn: signUp,
    onSuccess: (session) => {
      // Drop everything cached under whatever (anonymous) identity was
      // active before, then seed the session query directly with the real
      // result so `useSession`/`RequireAuth` see the new account right away.
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), session);
      // PRD §17: never make the participant search for the MUN again —
      // honor the same redirect target login already does, falling back to
      // /profile (where they can review what was just created) only when
      // there's nowhere meaningful to return to.
      navigate(redirectTo !== "/" ? redirectTo : "/profile", { replace: true });
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Unable to create your account.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    if (!form.acceptedTermsOfService || !form.acceptedPrivacyPolicy) {
      setFormError("You must accept the Terms of Service and Privacy Policy to create an account.");
      return;
    }

    signUpMutation.mutate(toSignUpInput(form));
  }

  const loginHref = redirectTo !== "/" ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login";
  const isMinor = (() => {
    if (!form.dateOfBirth) return false;
    const dob = new Date(form.dateOfBirth);
    if (Number.isNaN(dob.getTime())) return false;
    const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return age < 18;
  })();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Create an account | MUN Hub</title>
        <meta
          name="description"
          content="Create a MUN Hub student account to register for conferences and track your applications."
        />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 justify-center px-lg py-xxl md:py-section">
        <div className="w-full max-w-lg">
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Create your account
            </h1>
            <p className="text-body-md text-muted-foreground">
              We ask for this once — it pre-fills every MUN registration you make afterward, and
              you can update it any time from your profile.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-lg" noValidate>
            <Card>
              <CardHeader>
                <CardTitle>1. Account details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="name">Full name *</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    autoFocus
                    required
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Alex Kumar"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="email">Email address *</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="you@school.edu"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="password">Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="confirmPassword">Confirm password *</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={form.confirmPassword}
                    onChange={(e) => set("confirmPassword", e.target.value)}
                    placeholder="Re-enter your password"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Personal details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="dob">Date of birth *</Label>
                  <Input
                    id="dob"
                    type="date"
                    required
                    value={form.dateOfBirth}
                    onChange={(e) => set("dateOfBirth", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="gender">Gender *</Label>
                  <Input
                    id="gender"
                    required
                    value={form.gender}
                    onChange={(e) => set("gender", e.target.value)}
                    placeholder="e.g. Female, Male, Non-binary"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="preferredName">Preferred name</Label>
                  <Input
                    id="preferredName"
                    value={form.preferredName}
                    onChange={(e) => set("preferredName", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="nationality">Nationality</Label>
                  <Input
                    id="nationality"
                    value={form.nationality}
                    onChange={(e) => set("nationality", e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3. Contact details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="phone">Primary mobile number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    required
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="alternateMobile">Alternate mobile number</Label>
                  <Input
                    id="alternateMobile"
                    type="tel"
                    value={form.alternateMobile}
                    onChange={(e) => set("alternateMobile", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="address">Residential address *</Label>
                  <textarea
                    id="address"
                    rows={3}
                    required
                    className={textareaClassName}
                    value={form.residentialAddress}
                    onChange={(e) => set("residentialAddress", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-md">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={form.addressCity} onChange={(e) => set("addressCity", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="state">State</Label>
                    <Input id="state" value={form.addressState} onChange={(e) => set("addressState", e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={form.addressCountry}
                      onChange={(e) => set("addressCountry", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="postalCode">Postal code</Label>
                    <Input id="postalCode" value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-sm text-body-md text-body" htmlFor="transportation">
                  <Checkbox
                    id="transportation"
                    checked={form.requiresTransportation}
                    onCheckedChange={(checked) => set("requiresTransportation", checked === true)}
                  />
                  <Label htmlFor="transportation" className="cursor-pointer">
                    I&apos;ll need transportation assistance
                  </Label>
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>4. Academic details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="institution">School / college / university *</Label>
                  <Input
                    id="institution"
                    required
                    value={form.institution}
                    onChange={(e) => set("institution", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="gradeOrYear">Year of study *</Label>
                  <Input
                    id="gradeOrYear"
                    required
                    value={form.gradeOrYear}
                    onChange={(e) => set("gradeOrYear", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="courseOrProgram">Course / program</Label>
                  <Input
                    id="courseOrProgram"
                    value={form.courseOrProgram}
                    onChange={(e) => set("courseOrProgram", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-md">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="graduationYear">Graduation year</Label>
                    <Input
                      id="graduationYear"
                      type="number"
                      value={form.graduationYear}
                      onChange={(e) => set("graduationYear", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="department">Department</Label>
                    <Input id="department" value={form.department} onChange={(e) => set("department", e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="studentId">Student ID</Label>
                  <Input id="studentId" value={form.studentId} onChange={(e) => set("studentId", e.target.value)} />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="academicEmail">Academic email</Label>
                  <Input
                    id="academicEmail"
                    type="email"
                    value={form.academicEmail}
                    onChange={(e) => set("academicEmail", e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>5. Parent / emergency contact</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="ecName">Parent / guardian name *</Label>
                  <Input
                    id="ecName"
                    required
                    value={form.emergencyContactName}
                    onChange={(e) => set("emergencyContactName", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="ecPhone">Contact number *</Label>
                  <Input
                    id="ecPhone"
                    type="tel"
                    required
                    value={form.emergencyContactPhone}
                    onChange={(e) => set("emergencyContactPhone", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="ecRelation">Relationship *</Label>
                  <Input
                    id="ecRelation"
                    required
                    value={form.emergencyContactRelation}
                    onChange={(e) => set("emergencyContactRelation", e.target.value)}
                    placeholder="e.g. Father, Mother, Guardian"
                  />
                </div>
                <div className="flex flex-col gap-xs pt-sm">
                  <Label htmlFor="altEcName">Alternate emergency contact name</Label>
                  <Input
                    id="altEcName"
                    value={form.alternateEmergencyContactName}
                    onChange={(e) => set("alternateEmergencyContactName", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="altEcNumber">Alternate emergency contact number</Label>
                  <Input
                    id="altEcNumber"
                    type="tel"
                    value={form.alternateEmergencyContactNumber}
                    onChange={(e) => set("alternateEmergencyContactNumber", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="altEcRelation">Alternate contact relationship</Label>
                  <Input
                    id="altEcRelation"
                    value={form.alternateEmergencyContactRelation}
                    onChange={(e) => set("alternateEmergencyContactRelation", e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>6. Previous MUN experience &amp; achievements</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <label className="flex items-center gap-sm text-body-md text-body" htmlFor="hasPriorExperience">
                  <Checkbox
                    id="hasPriorExperience"
                    checked={form.hasPriorMunExperience}
                    onCheckedChange={(checked) => set("hasPriorMunExperience", checked === true)}
                  />
                  <Label htmlFor="hasPriorExperience" className="cursor-pointer">
                    I have attended an MUN before
                  </Label>
                </label>
                {form.hasPriorMunExperience ? (
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="munsAttendedCount">Number of MUNs attended</Label>
                    <Input
                      id="munsAttendedCount"
                      type="number"
                      min={0}
                      value={form.munsAttendedCount}
                      onChange={(e) => set("munsAttendedCount", e.target.value)}
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="munExperience">Previous MUN experience</Label>
                  <textarea
                    id="munExperience"
                    rows={3}
                    className={textareaClassName}
                    value={form.munExperience}
                    onChange={(e) => set("munExperience", e.target.value)}
                    placeholder="Briefly describe your MUN background..."
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="previousAchievements">Previous achievements</Label>
                  <textarea
                    id="previousAchievements"
                    rows={3}
                    className={textareaClassName}
                    value={form.previousAchievements}
                    onChange={(e) => set("previousAchievements", e.target.value)}
                    placeholder="Tell us about your previous MUN awards, leadership positions, academic achievements, or other relevant accomplishments..."
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>7. Profile preferences</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="bio">Short bio</Label>
                  <textarea
                    id="bio"
                    rows={2}
                    className={textareaClassName}
                    value={form.bio}
                    onChange={(e) => set("bio", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="areasOfInterest">Areas of interest</Label>
                  <Input
                    id="areasOfInterest"
                    value={form.areasOfInterest}
                    onChange={(e) => set("areasOfInterest", e.target.value)}
                    placeholder="Comma-separated, e.g. International Law, Climate Policy"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="languages">Languages</Label>
                  <Input
                    id="languages"
                    value={form.languages}
                    onChange={(e) => set("languages", e.target.value)}
                    placeholder="Comma-separated, e.g. English, Hindi"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="referralCode">Referral code</Label>
                  <Input
                    id="referralCode"
                    value={form.referralCode}
                    onChange={(e) => set("referralCode", e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-sm text-body-md text-body" htmlFor="publicVisibility">
                  <Checkbox
                    id="publicVisibility"
                    checked={form.isPublicProfileVisible}
                    onCheckedChange={(checked) => set("isPublicProfileVisible", checked === true)}
                  />
                  <Label htmlFor="publicVisibility" className="cursor-pointer">
                    Make my profile publicly visible
                  </Label>
                </label>
                <p className="text-body-sm text-muted-foreground">
                  Off by default. Your emergency contact and other private details are never shown
                  publicly regardless of this setting.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>8. Consent</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <label className="flex items-start gap-sm text-body-md text-body" htmlFor="acceptTos">
                  <Checkbox
                    id="acceptTos"
                    required
                    checked={form.acceptedTermsOfService}
                    onCheckedChange={(checked) => set("acceptedTermsOfService", checked === true)}
                  />
                  <Label htmlFor="acceptTos" className="cursor-pointer">
                    I agree to the Terms of Service *
                  </Label>
                </label>
                <label className="flex items-start gap-sm text-body-md text-body" htmlFor="acceptPrivacy">
                  <Checkbox
                    id="acceptPrivacy"
                    required
                    checked={form.acceptedPrivacyPolicy}
                    onCheckedChange={(checked) => set("acceptedPrivacyPolicy", checked === true)}
                  />
                  <Label htmlFor="acceptPrivacy" className="cursor-pointer">
                    I agree to the Privacy Policy *
                  </Label>
                </label>
                {isMinor ? (
                  <label className="flex items-start gap-sm text-body-md text-body" htmlFor="acceptGuardian">
                    <Checkbox
                      id="acceptGuardian"
                      checked={form.acceptedGuardianAcknowledgement}
                      onCheckedChange={(checked) => set("acceptedGuardianAcknowledgement", checked === true)}
                    />
                    <Label htmlFor="acceptGuardian" className="cursor-pointer">
                      My parent/guardian acknowledges and consents to my use of MUN Hub
                    </Label>
                  </label>
                ) : null}
              </CardContent>
            </Card>

            {formError ? (
              <p
                role="alert"
                className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px size-4 shrink-0 fill-current">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM8 12a.9.9 0 1 1 0-1.8A.9.9 0 0 1 8 12Z" />
                </svg>
                <span>{formError}</span>
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={signUpMutation.isPending}>
              {signUpMutation.isPending ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-xl border-t border-border pt-lg text-body-md text-muted-foreground">
            Already have an account?{" "}
            <Link to={loginHref} className="text-link underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
