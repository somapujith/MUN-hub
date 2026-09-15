import { cookies } from "next/headers";
import { getSessionByToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/adapter";

/**
 * Next.js app-layer session resolver (temporary until Phase 7 retires Next).
 *
 * Reads the `mun_hub_session` cookie and delegates to framework-agnostic
 * `getSessionByToken` in `lib/auth/session.ts`. `lib/` must never import
 * `next/headers` — only this app-layer helper (and route-local wrappers)
 * may bridge cookie → token.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "";
  return getSessionByToken(token);
}
