import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { munDocuments, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { runWithStorageBindings } from '@/lib/storage/bindings'
import { createInMemoryKv, SAMPLE_FILES } from '@/lib/storage/in-memory-bindings'
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

const PDF_BUFFER = SAMPLE_FILES.pdf

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

    it('rejects a file over 10MB before touching storage', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)

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

  describe('upload validation and storage', () => {
    it('rejects a non-PDF file declared as application/pdf without storing anything', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const kv = createInMemoryKv()

      await expect(
        runWithStorageBindings({ kv }, () =>
          uploadMunDocument(
            { munId: mun.id, kind: 'RULES', title: 'Rules', file: SAMPLE_FILES.html, contentType: 'application/pdf' },
            sessionFor(organizer),
          ),
        ),
      ).rejects.toThrow('a valid PDF document is required')

      expect(kv.entries.size).toBe(0)
      expect(await listMunDocuments(mun.id)).toHaveLength(0)
    })

    it('stores the PDF in the bound KV namespace and returns a files-route URL', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const kv = createInMemoryKv()

      const doc = await runWithStorageBindings({ kv, requestOrigin: 'http://localhost:3001' }, () =>
        uploadMunDocument(
          { munId: mun.id, kind: 'HANDBOOK', title: 'Handbook', file: PDF_BUFFER, contentType: 'application/pdf' },
          sessionFor(organizer),
        ),
      )

      expect(doc.url).toBe(`http://localhost:3001/api/v1/files/${doc.storageKey}`)
      expect(Buffer.from(kv.entries.get(doc.storageKey)!.value).equals(PDF_BUFFER)).toBe(true)
      expect(kv.entries.get(doc.storageKey)!.metadata).toMatchObject({ contentType: 'application/pdf' })
    })

    it('removes the new object again when the database write fails', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const kv = createInMemoryKv()

      await expect(
        runWithStorageBindings({ kv }, () =>
          uploadMunDocument(
            // An invalid enum value makes the insert fail after the bytes were written.
            { munId: mun.id, kind: 'NOT_A_KIND' as never, title: 'Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
            sessionFor(organizer),
          ),
        ),
      ).rejects.toThrow()

      expect(kv.entries.size).toBe(0)
    })

    it('deleteMunDocument removes the stored object, and a storage failure does not fail the delete', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const kv = createInMemoryKv()

      const [kept, failing] = await runWithStorageBindings({ kv }, async () => [
        await uploadMunDocument(
          { munId: mun.id, kind: 'RULES', title: 'Rules', file: PDF_BUFFER, contentType: 'application/pdf' },
          session,
        ),
        await uploadMunDocument(
          { munId: mun.id, kind: 'BROCHURE', title: 'Brochure', file: PDF_BUFFER, contentType: 'application/pdf' },
          session,
        ),
      ])

      await runWithStorageBindings({ kv }, () => deleteMunDocument(kept.id, session))
      expect(kv.entries.has(kept.storageKey)).toBe(false)

      const brokenKv = {
        ...kv,
        delete: async () => {
          throw new Error('KV unavailable')
        },
      }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await expect(
          runWithStorageBindings({ kv: brokenKv }, () => deleteMunDocument(failing.id, session)),
        ).resolves.toBeUndefined()
        expect(consoleError).toHaveBeenCalled()
      } finally {
        consoleError.mockRestore()
      }
      expect(await listMunDocuments(mun.id)).toHaveLength(0)
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
