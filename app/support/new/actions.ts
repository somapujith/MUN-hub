"use server";

import { createTicket, type CreateTicketInput } from "@/lib/actions/support";
import { getSession } from "@/app/lib/session";

/**
 * Thin Next wrapper: resolve session from the cookie and forward to the
 * now-parameterized `createTicket` in lib. The client form cannot call
 * `getSession()` itself; Phase 2's Hono route will supply session from
 * middleware instead of this bridge.
 */
export async function createTicketAction(input: CreateTicketInput) {
  const session = await getSession();
  return createTicket(input, session);
}
