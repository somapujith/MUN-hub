import type { Session } from "@/types";

/** Step 3: no real auth — always signed out. Step 4 will replace this. */
export async function getSession(): Promise<Session | null> {
  return null;
}
