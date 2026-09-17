import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munFaqs } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { assertMunPubliclyVisible } from './marketplace'

// -----------------------------------------------------------------------------
// mun-faq — the FAQ list on a MUN's public page (PRD Section 24).
// -----------------------------------------------------------------------------
//
// FAQs are not one of the 15 tracked go-live modules, so there is no
// completion row to recompute and no LOCKED gate: an organizer may edit them
// at any point, including while the mun is under review or already live.

export const FAQ_QUESTION_MAX_LENGTH = 300
export const FAQ_ANSWER_MAX_LENGTH = 4000

export interface MunFaq {
  id: string
  munId: string
  question: string
  answer: string
  displayOrder: number
  createdAt: Date
  updatedAt: Date
}

/** What an anonymous visitor sees. */
export interface PublicMunFaq {
  id: string
  question: string
  answer: string
  displayOrder: number
}

export interface MunFaqInput {
  question: string
  answer: string
  displayOrder?: number
}

function orderedFaqs(munId: string) {
  return db
    .select()
    .from(munFaqs)
    .where(eq(munFaqs.munId, munId))
    .orderBy(asc(munFaqs.displayOrder), asc(munFaqs.createdAt))
}

function cleanText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`)
  }
  return trimmed
}

/** Internal read (no visibility check) — prefer listPublicMunFaqs / listMunFaqsForOrganizer. */
export async function listMunFaqs(munId: string): Promise<MunFaq[]> {
  return orderedFaqs(munId)
}

/**
 * Public read for the MUN page. Throws `Mun not found` unless the mun is
 * publicly visible, so a draft's FAQs can't be read by guessing its id.
 */
export async function listPublicMunFaqs(munId: string): Promise<PublicMunFaq[]> {
  await assertMunPubliclyVisible(munId)
  return db
    .select({
      id: munFaqs.id,
      question: munFaqs.question,
      answer: munFaqs.answer,
      displayOrder: munFaqs.displayOrder,
    })
    .from(munFaqs)
    .where(eq(munFaqs.munId, munId))
    .orderBy(asc(munFaqs.displayOrder), asc(munFaqs.createdAt))
}

/** Organizer read — works in every lifecycle state. Owning organizer or admin only. */
export async function listMunFaqsForOrganizer(munId: string, session: Session | null): Promise<MunFaq[]> {
  await assertOwnsOrAdmin(munId, session)
  return orderedFaqs(munId)
}

/** Adds a FAQ, appended after the existing ones unless `displayOrder` is given. */
export async function createMunFaq(munId: string, input: MunFaqInput, session: Session | null): Promise<MunFaq> {
  await assertOwnsOrAdmin(munId, session)
  const question = cleanText(input.question, 'Question', FAQ_QUESTION_MAX_LENGTH)
  const answer = cleanText(input.answer, 'Answer', FAQ_ANSWER_MAX_LENGTH)

  let displayOrder = input.displayOrder
  if (displayOrder === undefined) {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${munFaqs.displayOrder}) + 1, 0)::int` })
      .from(munFaqs)
      .where(eq(munFaqs.munId, munId))
    displayOrder = next
  }

  const [faq] = await db.insert(munFaqs).values({ munId, question, answer, displayOrder }).returning()
  return faq
}

async function loadFaqOwnedBySession(id: string, session: Session | null): Promise<MunFaq> {
  const [faq] = await db.select().from(munFaqs).where(eq(munFaqs.id, id)).limit(1)
  if (!faq) throw new Error('FAQ not found')
  await assertOwnsOrAdmin(faq.munId, session)
  return faq
}

export async function updateMunFaq(
  id: string,
  input: Partial<MunFaqInput>,
  session: Session | null,
): Promise<MunFaq> {
  await loadFaqOwnedBySession(id, session)

  const values: Partial<Pick<MunFaq, 'question' | 'answer' | 'displayOrder'>> = {}
  if (input.question !== undefined) {
    values.question = cleanText(input.question, 'Question', FAQ_QUESTION_MAX_LENGTH)
  }
  if (input.answer !== undefined) {
    values.answer = cleanText(input.answer, 'Answer', FAQ_ANSWER_MAX_LENGTH)
  }
  if (input.displayOrder !== undefined) {
    values.displayOrder = input.displayOrder
  }

  const [updated] = await db
    .update(munFaqs)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(munFaqs.id, id))
    .returning()
  return updated
}

export async function deleteMunFaq(id: string, session: Session | null): Promise<void> {
  await loadFaqOwnedBySession(id, session)
  await db.delete(munFaqs).where(eq(munFaqs.id, id))
}
