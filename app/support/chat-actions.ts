"use server";

import {
  startConversation,
  sendMessage,
  getConversation,
  markConversationRead,
  listMyConversations,
  getUnreadConversationCount,
  getAdminUnreadConversationCount,
  type SupportTicketRow,
  type SupportMessageRow,
} from "@/lib/actions/support";
import { getSession } from "@/app/lib/session";
import type { SupportCategory } from "@/lib/db/schema-enums";

/**
 * Shared client-callable wrappers around `lib/actions/support`'s chat
 * surface — used by the floating support widget, `/dashboard/support`,
 * `/organizer/support`, and the admin reply thread on `/admin/support`. One
 * file because every one of those callers needs the exact same
 * start/send/read/list operations with the actor derived from
 * `getSession()`; role-specific behavior (what an "inbox" means) lives in
 * the calling page, not here.
 *
 * Same reasoning as `app/admin/support/actions.ts`: the lib actions THROW,
 * and a client component polling every few seconds needs a structured
 * result, not an unhandled rejection. No `revalidatePath` here — every
 * caller manages its own client-side state via refetch/poll rather than a
 * full page re-render, which would be jarring mid-conversation.
 */

export type ChatActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You don't have access to this conversation. Try signing in again.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

async function wrap<T>(fn: () => Promise<T>): Promise<ChatActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function startConversationAction(
  body: string,
  category?: SupportCategory
): Promise<ChatActionResult<{ ticket: SupportTicketRow; message: SupportMessageRow }>> {
  return wrap(async () => startConversation({ body, category }, await getSession()));
}

export async function sendMessageAction(
  ticketId: string,
  body: string
): Promise<ChatActionResult<SupportMessageRow>> {
  return wrap(async () => sendMessage(ticketId, body, await getSession()));
}

export async function getConversationAction(
  ticketId: string
): Promise<ChatActionResult<{ ticket: SupportTicketRow; messages: SupportMessageRow[] }>> {
  return wrap(async () => getConversation(ticketId, await getSession()));
}

export async function markConversationReadAction(ticketId: string): Promise<ChatActionResult<null>> {
  return wrap(async () => {
    await markConversationRead(ticketId, await getSession());
    return null;
  });
}

export async function listMyConversationsAction(): Promise<ChatActionResult<SupportTicketRow[]>> {
  return wrap(async () => listMyConversations(await getSession()));
}

export async function getUnreadConversationCountAction(): Promise<ChatActionResult<number>> {
  return wrap(async () => getUnreadConversationCount(await getSession()));
}

export async function getAdminUnreadConversationCountAction(): Promise<ChatActionResult<number>> {
  return wrap(async () => getAdminUnreadConversationCount(await getSession()));
}
