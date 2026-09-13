import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munDocuments, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { deleteMunDocument, listMunDocuments, uploadMunDocument } from './mun-documents'

async function makeUser(role: 'ORGANIZER' | 'ADMIN' | 'SUPER_ADMIN' | 'STUDENT') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, overrides: Partial<typeof muns.$inferInsert> = {}) {
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId,
      name: 'Docs Mun',
      slug: `docs-mun-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

const PDF_BUFFER = Buffer.from('%PDF-1.4 fake bytes')

describe('mun-documents actions', () => {
  describe('uploadMunDocument', () => {
    it('lets the owning organizer upload a rules document', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const doc = await uploadMunDocument(
        { munId: mun.id, kind: 'RULES', title: 'Rules of Procedure', file: PDF_BUFFER, contentType: 'application/pdf' },
        session,
      )

      expect(doc.munId).toBe(mun.id)
      expect(doc.kind).toBe('RULES')
      expect(doc.storageKey).toMatch(new RegExp(`^muns/${mun.id}/documents/`))
      expect(doc.sizeBytes).toBe(PDF_BUFFER.byteLength)
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        uploadMunDocument(
          { munId: mun.id, kind: 'RULES', title: 'Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
          sessionFor(stranger),
        ),
      ).rejects.toThrow('Forbidden')
    })

    it('rejects a non-PDF content type', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await expect(
        uploadMunDocument(
          { munId: mun.id, kind: 'RULES', title: 'Rules', file: PDF_BUFFER, contentType: 'image/png' },
          session,
        ),
      ).rejects.toThrow(/unsupported content type/i)
    })

    it('rejects a file over 20MB before touching storage', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const oversized = Buffer.alloc(20 * 1024 * 1024 + 1)

      await expect(
        uploadMunDocument(
          { munId: mun.id, kind: 'RULES', title: 'Rules', file: oversized, contentType: 'application/pdf' },
          session,
        ),
      ).rejects.toThrow(/too large/i)

      const rows = await db.select().from(munDocuments).where(eq(munDocuments.munId, mun.id))
      expect(rows).toHaveLength(0)
    })
  })

  describe('listMunDocuments', () => {
    it('lists documents scoped to the given mun only', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await uploadMunDocument(
        { munId: munA.id, kind: 'RULES', title: 'A Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
        session,
      )
      await uploadMunDocument(
        { munId: munB.id, kind: 'RULES', title: 'B Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
        session,
      )

      const listA = await listMunDocuments(munA.id)
      expect(listA).toHaveLength(1)
      expect(listA[0].title).toBe('A Rules')
    })
  })

  describe('deleteMunDocument', () => {
    it('lets the owning organizer delete a document', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const doc = await uploadMunDocument(
        { munId: mun.id, kind: 'RULES', title: 'Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
        session,
      )

      await deleteMunDocument(doc.id, session)

      const [row] = await db.select().from(munDocuments).where(eq(munDocuments.id, doc.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const doc = await uploadMunDocument(
        { munId: mun.id, kind: 'RULES', title: 'Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
        sessionFor(owner),
      )

      await expect(deleteMunDocument(doc.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
