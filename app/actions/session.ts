"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/actions/auth";

/**
 * Form-bound sign-out for the site header's user menu.
 *
 * `signOut()` in `lib/actions/auth.ts` is the frozen backend contract (clears
 * the session row + cookie); this wrapper only adds the route-layer concerns
 * the header needs — cache revalidation and a redirect back to the homepage —
 * so no UI component has to call `redirect()` itself.
 */
export async function signOutAction(): Promise<void> {
  await signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
