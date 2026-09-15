import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { munFaqs } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'

export async function listMunFaqs(munId: string) {
  return db.select().from(munFaqs).where(eq(munFaqs.munId, munId)).orderBy(asc(munFaqs.displayOrder))
}

export async function createMunFaq(munId: string, question: string, answer: string, session: Session | null) {
  await assertOwnsOrAdmin(munId, session)
  const existing = await listMunFaqs(munId)
  const [faq] = await db.insert(munFaqs).values({ munId, question, answer, displayOrder: existing.length }).returning()
  return faq
}

export async function deleteMunFaq(id: string, session: Session | null) {
  const [faq] = await db.select({ munId: munFaqs.munId }).from(munFaqs).where(eq(munFaqs.id, id)).limit(1)
  if (!faq) throw new Error('FAQ not found')
  await assertOwnsOrAdmin(faq.munId, session)
  await db.delete(munFaqs).where(eq(munFaqs.id, id))
}