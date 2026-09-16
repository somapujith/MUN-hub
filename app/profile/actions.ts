"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { safeRedirectTo } from "@/app/login/redirect";
import { completeStudentProfile } from "@/lib/actions/student-profile";
import { changePassword } from "@/lib/actions/auth";
import { setEmailNotificationsEnabled } from "@/lib/actions/account";
import type { StudentProfileInput } from "@/lib/types";

/**
 * Result shape for the profile form's `useActionState`. Simpler than
 * `RegisterFormState` (no `reason` discriminant) — every error here just
 * re-renders the same single-step form with the thrown message, there's no
 * per-step routing to do.
 */
export interface ProfileFormState {
  status: "idle" | "error";
  message?: string;
}

/**
 * Creates or updates the signed-in student's onboarding profile.
 * `completeStudentProfile` is an upsert, so this one action serves both the
 * first-time "complete your profile" flow and later edits.
 *
 * The acting user is re-derived from `getSession()` here, never trusted from
 * the form — same IDOR discipline as `submitRegistrationAction`.
 */
export async function saveProfileAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/profile")}`);
  }

  const requiresTransportation = String(formData.get("requiresTransportation") ?? "") === "yes";

  const input: StudentProfileInput = {
    phone: String(formData.get("phone") ?? "").trim(),
    institution: String(formData.get("institution") ?? "").trim(),
    dateOfBirth: String(formData.get("dateOfBirth") ?? "").trim(),
    gradeOrYear: String(formData.get("gradeOrYear") ?? "").trim(),
    residentialAddress: String(formData.get("residentialAddress") ?? "").trim(),
    requiresTransportation,
    emergencyContactName: String(formData.get("emergencyContactName") ?? "").trim(),
    emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? "").trim(),
    emergencyContactRelation: String(formData.get("emergencyContactRelation") ?? "").trim(),
    munExperience: String(formData.get("munExperience") ?? "").trim() || undefined,
    referralCode: String(formData.get("referralCode") ?? "").trim() || undefined,
  };

  try {
    await completeStudentProfile(input, session);
  } catch (error) {
    // completeStudentProfile's thrown messages are already human-readable
    // (e.g. "Phone number is required") — surface them directly, no rewrap.
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Something went wrong saving your profile. Please try again.",
    };
  }

  const redirectTo = safeRedirectTo(formData.get("redirectTo"));
  redirect(redirectTo === "/" ? "/dashboard" : redirectTo);
}

/** Result shape for the change-password form's `useActionState`. */
export interface ChangePasswordFormState {
  status: "idle" | "error" | "success";
  message?: string;
}

/**
 * Changes the signed-in user's password. The acting user is re-derived from
 * `getSession()`, never trusted from the form — same IDOR discipline as
 * `saveProfileAction`.
 *
 * Unlike `saveProfileAction`, this form lives inline on a page with other
 * content (the "Account & security" section of `/profile`), so it never
 * redirects — both the missing-session edge case and the success case just
 * re-render the same form in place with a message.
 */
export async function changePasswordAction(
  _prevState: ChangePasswordFormState,
  formData: FormData,
): Promise<ChangePasswordFormState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Your session expired. Sign in again." };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return { status: "error", message: "New passwords don't match." };
  }

  try {
    await changePassword(currentPassword, newPassword, session);
  } catch (error) {
    // changePassword's thrown messages are already human-readable (e.g.
    // "Current password is incorrect") — surface them directly, no rewrap.
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Something went wrong changing your password. Please try again.",
    };
  }

  return { status: "success", message: "Password updated." };
}

/**
 * Updates the signed-in user's email-notifications preference. A simple
 * fire-and-forget checkbox-toggle form (not a `useActionState` form with
 * inline error display), so unlike `changePasswordAction` it redirects on
 * both the missing-session and success paths — same idiom as
 * `signOutAction` in `app/actions/session.ts`.
 */
export async function updateEmailNotificationsAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/profile")}`);
  }

  const enabled = formData.get("emailNotificationsEnabled") === "on";
  await setEmailNotificationsEnabled(enabled, session);

  redirect("/profile");
}
