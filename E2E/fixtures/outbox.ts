import { expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { EMAIL_OUTBOX_FILE } from '../paths'

/**
 * Reads the local API's email outbox (EMAIL_OUTBOX_FILE, written by
 * lib/notifications/console-adapter.ts in dev/test only). Emails are sent
 * fire-and-forget after the triggering request returns, so always wait.
 */

export interface OutboxEmail {
  to: string
  subject: string
  text: string
  html: string | null
  sentAt: string
}

export async function readOutbox(): Promise<OutboxEmail[]> {
  let raw = ''
  try {
    raw = await readFile(EMAIL_OUTBOX_FILE, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as OutboxEmail)
}

/** Every email sent to `to` (case-insensitive), oldest first. */
export async function emailsTo(to: string): Promise<OutboxEmail[]> {
  const address = to.trim().toLowerCase()
  return (await readOutbox()).filter((email) => email.to.toLowerCase() === address)
}

/** Waits for an email to `to` whose subject matches, and returns the newest such email. */
export async function waitForEmail(
  to: string,
  subject: string | RegExp,
  { timeout = 10_000, after }: { timeout?: number; after?: Date } = {},
): Promise<OutboxEmail> {
  const matches = (email: OutboxEmail) =>
    (typeof subject === 'string' ? email.subject === subject : subject.test(email.subject)) &&
    (!after || new Date(email.sentAt) >= after)
  let found: OutboxEmail | undefined
  await expect
    .poll(
      async () => {
        found = (await emailsTo(to)).filter(matches).at(-1)
        return Boolean(found)
      },
      { timeout, message: `no email to ${to} with subject ${subject}` },
    )
    .toBe(true)
  return found!
}

/** Asserts that no email to `to` matching `subject` arrives within `waitMs`. */
export async function expectNoEmail(to: string, subject: string | RegExp, waitMs = 2_000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  const matching = (await emailsTo(to)).filter((email) =>
    typeof subject === 'string' ? email.subject === subject : subject.test(email.subject),
  )
  expect(matching, `unexpected email to ${to}`).toEqual([])
}

/** The first URL in an email's text that contains `pathFragment`. */
export function linkIn(email: OutboxEmail, pathFragment: string): URL {
  const url = (email.text.match(/https?:\/\/\S+/g) ?? []).find((candidate) => candidate.includes(pathFragment))
  expect(url, `email "${email.subject}" has no link containing ${pathFragment}`).toBeTruthy()
  return new URL(url!.replace(/[).,]+$/, ''))
}
