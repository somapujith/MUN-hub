"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Form-bound sign-out for the site header's user menu.
 *
 * `signOut(token)` in `lib/actions/auth.ts` is the frozen backend contract
 * (clears the session row) but no longer touches cookies itself — this
 * wrapper reads the session cookie, passes its token to `signOut`, then
 * clears the cookie and adds the route-layer concerns the header needs
 * (cache revalidation, redirect back to the homepage) so no UI component
 * has to call `redirect()` itself.
 */
export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "";

  await signOut(token);
  cookieStore.delete(SESSION_COOKIE_NAME);

  revalidatePath("/", "layout");
  redirect("/");
}
