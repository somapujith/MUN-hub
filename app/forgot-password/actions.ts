"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/actions/password-reset";

export async function requestResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect("/forgot-password?error=missing-email");
  }

  // Resolve the request's own origin rather than hardcoding NEXT_PUBLIC_APP_URL —
  // mirrors app/register/[slug]/actions.ts's completeMockPaymentAction so this
  // doesn't silently break under a deployment target where that env var isn't set.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${protocol}://${host}` : "http://localhost:3000";

  await requestPasswordReset(email, baseUrl);

  redirect("/forgot-password?sent=1");
}
