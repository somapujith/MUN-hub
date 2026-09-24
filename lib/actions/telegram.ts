import { and, eq, gt, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { telegramLinks } from '@/lib/db/schema'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/auth/opaque-token'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import type { Role } from '@/lib/db/schema-enums'
import { getRuntimeEnv } from '@/lib/runtime-env'

// Duplicated from lib/actions/support.ts's STAFF_ROLES rather than imported,
// to avoid a circular import: support.ts calls into this file to send the
// notifications below.
const STAFF_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const satisfies readonly Role[]

// ---------------------------------------------------------------------------
// Telegram notifications for the admin support module — each staff member
// (OPERATIONS/ADMIN/SUPER_ADMIN) can link their own Telegram chat so the bot
// pings them when a new ticket is raised or a requester replies. Linking is
// a two-step handshake, the same shape as email verification / password
// reset:
//
//   1. startTelegramLink (this file): staff clicks "Link Telegram" in
//      /admin/support, we generate a single-use token, store its hash
//      against their userId with chatId still null, and hand back the bot's
//      deep link (t.me/<bot>?start=<token>).
//   2. Staff opens that link in Telegram and sends /start <token>. Telegram
//      POSTs the update to our webhook (server/routes/webhooks.ts), which
//      calls completeTelegramLink with the token and the chat id Telegram
//      gives us — no session involved, the token IS the proof.
//
// unlinkTelegram lets a staff member remove their own link at any time.
// notifyStaffNewTicket / notifyStaffTicketReply (called from
// lib/actions/support.ts) send a message to every linked chat.
// ---------------------------------------------------------------------------

const LINK_TOKEN_TTL_MS = 1000 * 60 * 15 // 15 minutes — plenty for "open Telegram, tap Start"

/** Thrown by startTelegramLink when TELEGRAM_BOT_USERNAME isn't set (e.g. local dev). */
export const TELEGRAM_NOT_CONFIGURED = 'Telegram notifications are not configured'

function telegramApiUrl(method: string): string | null {
  const token = getRuntimeEnv('TELEGRAM_BOT_TOKEN')
  return token ? `https://api.telegram.org/bot${token}/${method}` : null
}

export interface TelegramLinkStatus {
  linked: boolean
  /** Set while a link is pending (token generated, not yet completed). */
  pending: boolean
}

/** Whether the caller has a completed Telegram link, or a pending one waiting on /start. */
export async function getTelegramLinkStatus(session: Session | null): Promise<TelegramLinkStatus> {
  requireRole(session, [...STAFF_ROLES])

  const [row] = await db
    .select({ chatId: telegramLinks.chatId, linkTokenExpiresAt: telegramLinks.linkTokenExpiresAt })
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, session.userId))
    .limit(1)

  if (!row) return { linked: false, pending: false }
  const pending = row.chatId === null && row.linkTokenExpiresAt !== null && row.linkTokenExpiresAt.getTime() > Date.now()
  return { linked: row.chatId !== null, pending }
}

/**
 * Starts (or restarts) a link: generates a fresh single-use token and
 * returns the bot deep link to open in Telegram. Safe to call again if the
 * staff member never finished the handshake — an old token from this row is
 * simply overwritten and can no longer complete.
 */
export async function startTelegramLink(session: Session | null): Promise<{ deepLink: string }> {
  requireRole(session, [...STAFF_ROLES])

  const botUsername = getRuntimeEnv('TELEGRAM_BOT_USERNAME')
  if (!botUsername) throw new Error(TELEGRAM_NOT_CONFIGURED)

  const token = generateOpaqueToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS)

  await db
    .insert(telegramLinks)
    .values({
      userId: session.userId,
      linkToken: hashOpaqueToken(token),
      linkTokenExpiresAt: expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { linkToken: hashOpaqueToken(token), linkTokenExpiresAt: expiresAt, updatedAt: now },
    })

  return { deepLink: `https://t.me/${botUsername}?start=${token}` }
}

/** Removes the caller's own link. Idempotent — unlinking when nothing is linked is a no-op. */
export async function unlinkTelegram(session: Session | null): Promise<void> {
  requireRole(session, [...STAFF_ROLES])
  await db.delete(telegramLinks).where(eq(telegramLinks.userId, session.userId))
}

/**
 * Called by the Telegram webhook when a staff member sends /start <token> to
 * the bot. No session — the token is the only credential. A missing or
 * expired token is a silent no-op (bad/stale deep link, replay, or someone
 * poking the bot with a made-up value); the bot still replies so a genuine
 * user isn't left wondering, but nothing is written.
 */
export async function completeTelegramLink(token: string, chatId: string): Promise<boolean> {
  const now = new Date()
  const result = await db
    .update(telegramLinks)
    .set({ chatId, linkToken: null, linkTokenExpiresAt: null, linkedAt: now, updatedAt: now })
    .where(and(eq(telegramLinks.linkToken, hashOpaqueToken(token)), gt(telegramLinks.linkTokenExpiresAt, now)))
    .returning({ id: telegramLinks.id })

  return result.length > 0
}

/**
 * Handles one Telegram `Update` payload (server/routes/webhooks.ts). The
 * only command this bot understands is the /start deep link the "Link
 * Telegram" button sends the staff member to; anything else gets a plain
 * "I don't understand" reply so the chat doesn't look broken. Never throws —
 * Telegram retries a webhook that 5xxs, and an update we can't make sense of
 * isn't worth retrying.
 */
export async function handleTelegramUpdate(update: unknown): Promise<void> {
  const message = (update as { message?: { chat?: { id?: number | string }; text?: string } } | null)?.message
  const chatId = message?.chat?.id
  const text = message?.text
  if (chatId === undefined || !text) return

  const match = /^\/start(?:@\w+)?\s+(\S+)/.exec(text.trim())
  if (!match) {
    await sendTelegramMessage(String(chatId), "I didn't recognize that. Use the \"Link Telegram\" button in MUNHub's admin support settings.")
    return
  }

  const linked = await completeTelegramLink(match[1], String(chatId))
  await sendTelegramMessage(
    String(chatId),
    linked
      ? "You're linked. This chat will get a message for every new support ticket and requester reply."
      : "That link has expired or was already used. Go back to MUNHub's admin support settings and click \"Link Telegram\" again.",
  )
}

/** Sends `text` to one Telegram chat. Failures are logged, never thrown — a notification is best-effort. */
async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const url = telegramApiUrl('sendMessage')
  if (!url) return

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
    if (!response.ok) {
      console.error('[telegram] sendMessage failed', { chatId, status: response.status, body: await response.text() })
    }
  } catch (error) {
    console.error('[telegram] sendMessage failed', { chatId, error })
  }
}

async function linkedChatIds(): Promise<string[]> {
  const rows = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(isNotNull(telegramLinks.chatId))
  return rows.map((row) => row.chatId).filter((chatId): chatId is string => chatId !== null)
}

/** "New support ticket" ping to every staff member who has linked Telegram. Never throws. */
export async function notifyStaffNewTicket(params: { ticketId: string; subject: string; requesterName: string }): Promise<void> {
  const chatIds = await linkedChatIds()
  if (chatIds.length === 0) return

  const text = `New support ticket from ${params.requesterName}\n"${params.subject}"\n\n${supportAdminUrl(params.ticketId)}`
  await Promise.all(chatIds.map((chatId) => sendTelegramMessage(chatId, text)))
}

/** "Requester replied" ping — only fires for a reply from the requester, not a staff reply to themselves. */
export async function notifyStaffTicketReply(params: { ticketId: string; subject: string; requesterName: string }): Promise<void> {
  const chatIds = await linkedChatIds()
  if (chatIds.length === 0) return

  const text = `${params.requesterName} replied on "${params.subject}"\n\n${supportAdminUrl(params.ticketId)}`
  await Promise.all(chatIds.map((chatId) => sendTelegramMessage(chatId, text)))
}

function supportAdminUrl(ticketId: string): string {
  const baseUrl = getRuntimeEnv('APP_URL') ?? 'http://localhost:5174'
  return `${baseUrl}/admin/support?ticket=${ticketId}`
}
