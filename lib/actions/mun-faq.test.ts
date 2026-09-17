import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munFaqs, muns, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import {
  createMunFaq,
  deleteMunFaq,
  FAQ_QUESTION_MAX_LENGTH,
  listMunFaqsForOrganizer,
  listPublicMunFaqs,
  updateMunFaq,
} from './mun-faq'

describe('mun-faq actions', () => {
  const suffix = crypto.randomUUID()
  let ownerSession: Session
  let strangerSession: Session
  const adminSession: Session = { userId: 'admin-not-a-real-row', role: 'ADMIN' }
  let publishedMunId: string
  let draftMunId: string
  const userIds: string[] = []

  beforeAll(async () => {
    const [owner, stranger] = await db
      .insert(users)
      .values([
        { name: 'FAQ Owner', email: `faq-owner-${suffix}@test.com`, role: 'ORGANIZER' },
        { name: 'FAQ Stranger', email: `faq-stranger-${suffix}@test.com`, role: 'ORGANIZER' },
      ])
      .returning()
    userIds.push(owner.id, stranger.id)
    ownerSession = { userId: owner.id, role: 'ORGANIZER' }
    strangerSession = { userId: stranger.id, role: 'ORGANIZER' }

    const [published, draft] = await db
      .insert(muns)
      .values([
        { organizerId: owner.id, name: 'FAQ Published', slug: `faq-published-${suffix}`, status: 'REGISTRATION_OPEN' },
        { organizerId: owner.id, name: 'FAQ Draft', slug: `faq-draft-${suffix}`, status: 'ONBOARDING' },
      ])
      .returning()
    publishedMunId = published.id
    draftMunId = draft.id
  })

  afterAll(async () => {
    await db.delete(muns).where(inArray(muns.organizerId, userIds))
    await db.delete(users).where(inArray(users.id, userIds))
  })

  it('lets the owner create FAQs, appended in order, with trimmed text', async () => {
    const first = await createMunFaq(publishedMunId, { question: '  Is there a dress code? ', answer: 'Western formals.' }, ownerSession)
    const second = await createMunFaq(publishedMunId, { question: 'Is lunch included?', answer: 'Yes, on both days.' }, ownerSession)

    expect(first.question).toBe('Is there a dress code?')
    expect(second.displayOrder).toBe(first.displayOrder + 1)

    const publicFaqs = await listPublicMunFaqs(publishedMunId)
    expect(publicFaqs.map((f) => f.question)).toEqual(['Is there a dress code?', 'Is lunch included?'])
    expect(Object.keys(publicFaqs[0]).sort()).toEqual(['answer', 'displayOrder', 'id', 'question'])
  })

  it('refuses FAQ writes from a non-owner and from anonymous callers', async () => {
    await expect(
      createMunFaq(publishedMunId, { question: 'Q', answer: 'A' }, strangerSession),
    ).rejects.toThrow('Forbidden')
    await expect(createMunFaq(publishedMunId, { question: 'Q', answer: 'A' }, null)).rejects.toThrow('Forbidden')

    const faq = await createMunFaq(publishedMunId, { question: 'Owner only?', answer: 'Yes.' }, ownerSession)
    await expect(updateMunFaq(faq.id, { answer: 'Hijacked' }, strangerSession)).rejects.toThrow('Forbidden')
    await expect(deleteMunFaq(faq.id, strangerSession)).rejects.toThrow('Forbidden')
    await expect(listMunFaqsForOrganizer(publishedMunId, strangerSession)).rejects.toThrow('Forbidden')
  })

  it('lets an admin manage any mun’s FAQs', async () => {
    const faq = await createMunFaq(publishedMunId, { question: 'Admin added?', answer: 'Yes.' }, adminSession)
    const updated = await updateMunFaq(faq.id, { answer: 'Edited by admin.' }, adminSession)
    expect(updated.answer).toBe('Edited by admin.')
    await deleteMunFaq(faq.id, adminSession)
    const [gone] = await db.select().from(munFaqs).where(eq(munFaqs.id, faq.id))
    expect(gone).toBeUndefined()
  })

  it('rejects empty and over-long text', async () => {
    await expect(createMunFaq(publishedMunId, { question: '   ', answer: 'A' }, ownerSession)).rejects.toThrow(
      'Question is required',
    )
    await expect(createMunFaq(publishedMunId, { question: 'Q', answer: '' }, ownerSession)).rejects.toThrow(
      'Answer is required',
    )
    await expect(
      createMunFaq(publishedMunId, { question: 'x'.repeat(FAQ_QUESTION_MAX_LENGTH + 1), answer: 'A' }, ownerSession),
    ).rejects.toThrow(/at most/)
  })

  it('updates only the fields given and bumps updatedAt', async () => {
    const faq = await createMunFaq(publishedMunId, { question: 'Venue parking?', answer: 'Limited.' }, ownerSession)
    const updated = await updateMunFaq(faq.id, { displayOrder: 99 }, ownerSession)
    expect(updated.question).toBe('Venue parking?')
    expect(updated.answer).toBe('Limited.')
    expect(updated.displayOrder).toBe(99)
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(faq.updatedAt.getTime())
  })

  it('throws FAQ not found for an unknown id', async () => {
    await expect(updateMunFaq(crypto.randomUUID(), { answer: 'x' }, ownerSession)).rejects.toThrow('FAQ not found')
    await expect(deleteMunFaq(crypto.randomUUID(), ownerSession)).rejects.toThrow('FAQ not found')
  })

  it('hides a non-public mun’s FAQs from the public read but not from its owner', async () => {
    await createMunFaq(draftMunId, { question: 'Draft question?', answer: 'Draft answer.' }, ownerSession)

    await expect(listPublicMunFaqs(draftMunId)).rejects.toThrow('Mun not found')
    const ownerView = await listMunFaqsForOrganizer(draftMunId, ownerSession)
    expect(ownerView.map((f) => f.question)).toEqual(['Draft question?'])
  })
})
