"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/actions/auth";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { safeRedirectTo } from "./redirect";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches lib/auth/session.ts SESSION_TTL_MS

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectTo(formData.get("redirectTo"));

  if (!email) {
    redirect(`/login?error=missing-email&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  let token: string;
  let expiresAt: Date;
  try {
    ({ token, expiresAt } = await signIn(email, password));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Account suspended") {
      redirect(`/login?error=suspended&redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    redirect(`/login?error=invalid-credentials&redirectTo=${encodeURIComponent(redirectTo)}`);
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

  redirect(redirectTo);
}
