"use server";

import { redirect } from "next/navigation";
import { resetPassword } from "@/lib/actions/password-reset";

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmNewPassword = String(formData.get("confirmNewPassword") ?? "");

  if (newPassword !== confirmNewPassword) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=password-mismatch`);
  }

  try {
    await resetPassword(token, newPassword);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    let errorKey = "unknown";
    if (message === "This reset link is invalid or has expired") {
      errorKey = "invalid-token";
    } else if (message === "Password must be at least 8 characters") {
      errorKey = "weak-password";
    }
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${errorKey}`);
  }

  redirect("/login?reset=success");
}
