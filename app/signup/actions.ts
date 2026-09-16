"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signUp } from "@/lib/actions/auth";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { safeRedirectTo } from "../login/redirect";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches lib/auth/session.ts SESSION_TTL_MS

export async function signupAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));

  if (password !== confirmPassword) {
    redirect(`/signup?error=password-mismatch&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  let token: string;
  let expiresAt: Date;
  try {
    ({ token, expiresAt } = await signUp(name, email, password));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    let errorKey = "unknown";
    if (message === "An account with that email already exists") {
      errorKey = "email-taken";
    } else if (message === "Password must be at least 8 characters") {
      errorKey = "weak-password";
    } else if (message === "Name is required") {
      errorKey = "missing-name";
    }
    redirect(`/signup?error=${errorKey}&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    expires: expiresAt,
  });

  redirect(`/profile?redirectTo=${encodeURIComponent(redirectTo)}`);
}
