"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/actions/auth";
import { safeRedirectTo } from "./redirect";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));

  if (!email) {
    redirect(`/login?error=missing-email&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  try {
    await signIn(email);
  } catch {
    redirect(`/login?error=not-found&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  redirect(redirectTo);
}
