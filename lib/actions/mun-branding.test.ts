import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munMedia, muns, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { runWithStorageBindings } from '@/lib/storage/bindings'
import { createInMemoryKv, paddedFile, SAMPLE_FILES } from '@/lib/storage/in-memory-bindings'
import { deleteMunMedia, listMunMedia, reorderGallery, uploadMunMedia } from './mun-branding'

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
      name: 'Branding Mun',
      slug: `branding-mun-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

const PNG_BUFFER = SAMPLE_FILES.png

describe('mun-branding actions', () => {
  describe('uploadMunMedia', () => {
    it('lets the owning organizer upload a gallery image', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const media = await uploadMunMedia(
        { munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' },
        session,
      )

      expect(media.munId).toBe(mun.id)
      expect(media.kind).toBe('GALLERY')
      expect(media.storageKey).toMatch(new RegExp(`^muns/${mun.id}/branding/`))
      expect(media.contentType).toBe('image/png')
      expect(media.sizeBytes).toBe(PNG_BUFFER.byteLength)
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(
        uploadMunMedia(
          { munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' },
          sessionFor(stranger),
        ),
      ).rejects.toThrow('Forbidden')
    })

    it('rejects an oversized file before touching storage', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1)

      await expect(
        uploadMunMedia({ munId: mun.id, kind: 'GALLERY', file: oversized, contentType: 'image/png' }, session),
      ).rejects.toThrow(/too large/i)

      const rows = await db.select().from(munMedia).where(eq(munMedia.munId, mun.id))
      expect(rows).toHaveLength(0)
    })

    it('rejects a disallowed content type', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await expect(
        uploadMunMedia(
          { munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'application/pdf' },
          session,
        ),
      ).rejects.toThrow(/unsupported content type/i)
    })

    it('upserts LOGO: uploading a second logo replaces the first', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const first = await uploadMunMedia(
        { munId: mun.id, kind: 'LOGO', file: PNG_BUFFER, contentType: 'image/png' },
        session,
      )
      const second = await uploadMunMedia(
        { munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.webp, contentType: 'image/webp' },
        session,
      )

      const rows = await db
        .select()
        .from(munMedia)
        .where(eq(munMedia.munId, mun.id))
      const logos = rows.filter((r) => r.kind === 'LOGO')
      expect(logos).toHaveLength(1)
      expect(logos[0].id).toBe(second.id)
      expect(logos[0].id).not.toBe(first.id)
    })

    it('does not upsert GALLERY: multiple uploads coexist', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await uploadMunMedia({ munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' }, session)
      await uploadMunMedia({ munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' }, session)

      const list = await listMunMedia(mun.id)
      expect(list.filter((m) => m.kind === 'GALLERY')).toHaveLength(2)
    })
  })

  describe('upload validation and storage', () => {
    it('rejects HTML bytes declared as image/png without storing anything', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const kv = createInMemoryKv()

      await expect(
        runWithStorageBindings({ kv }, () =>
          uploadMunMedia(
            { munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.html, contentType: 'image/png' },
            sessionFor(organizer),
          ),
        ),
      ).rejects.toThrow(/do not match its declared type/)

      expect(kv.entries.size).toBe(0)
      expect(await listMunMedia(mun.id)).toHaveLength(0)
    })

    it('caps logos at 2MB but lets a cover of the same size through', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const threeMb = paddedFile(SAMPLE_FILES.png, 3 * 1024 * 1024)

      await expect(
        uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: threeMb, contentType: 'image/png' }, session),
      ).rejects.toThrow('maximum allowed size is 2MB')
      await expect(
        uploadMunMedia({ munId: mun.id, kind: 'COVER', file: threeMb, contentType: 'image/png' }, session),
      ).resolves.toMatchObject({ kind: 'COVER' })
    })

    it('stores the bytes in the bound KV namespace and returns a files-route URL', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const kv = createInMemoryKv()

      const media = await runWithStorageBindings({ kv, requestOrigin: 'http://localhost:3001' }, () =>
        uploadMunMedia(
          { munId: mun.id, kind: 'COVER', file: SAMPLE_FILES.jpeg, contentType: 'image/jpeg' },
          sessionFor(organizer),
        ),
      )

      expect(media.url).toBe(`http://localhost:3001/api/v1/files/${media.storageKey}`)
      expect(Buffer.from(kv.entries.get(media.storageKey)!.value).equals(SAMPLE_FILES.jpeg)).toBe(true)
    })

    it('deletes the replaced logo object after the new logo is saved', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const kv = createInMemoryKv()

      const [first, second] = await runWithStorageBindings({ kv }, async () => [
        await uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.png, contentType: 'image/png' }, session),
        await uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.webp, contentType: 'image/webp' }, session),
      ])

      expect(kv.entries.has(first.storageKey)).toBe(false)
      expect(kv.entries.has(second.storageKey)).toBe(true)
    })

    it('keeps exactly one logo when two replacements race', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const kv = createInMemoryKv()

      await runWithStorageBindings({ kv }, async () => {
        await uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.png, contentType: 'image/png' }, session)
        await Promise.all(
          Array.from({ length: 4 }, () =>
            uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.png, contentType: 'image/png' }, session),
          ),
        )
      })

      const logos = (await listMunMedia(mun.id)).filter((m) => m.kind === 'LOGO')
      expect(logos).toHaveLength(1)
      expect([...kv.entries.keys()]).toEqual([logos[0].storageKey])
    })

    it('removes the new object again when the database write fails', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const kv = createInMemoryKv()

      // displayOrder outside Postgres's integer range makes the insert fail
      // after the bytes were already written.
      await expect(
        runWithStorageBindings({ kv }, () =>
          uploadMunMedia(
            { munId: mun.id, kind: 'GALLERY', file: SAMPLE_FILES.png, contentType: 'image/png', displayOrder: 2 ** 31 },
            sessionFor(organizer),
          ),
        ),
      ).rejects.toThrow()

      expect(kv.entries.size).toBe(0)
    })

    it('deleteMunMedia removes the stored object', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const kv = createInMemoryKv()

      await runWithStorageBindings({ kv }, async () => {
        const media = await uploadMunMedia(
          { munId: mun.id, kind: 'GALLERY', file: SAMPLE_FILES.png, contentType: 'image/png' },
          session,
        )
        expect(kv.entries.has(media.storageKey)).toBe(true)
        await deleteMunMedia(media.id, session)
      })

      expect(kv.entries.size).toBe(0)
    })
  })

  describe('listMunMedia', () => {
    it('lists media scoped to the given mun only', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      await uploadMunMedia({ munId: munA.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' }, session)
      await uploadMunMedia({ munId: munB.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' }, session)

      const listA = await listMunMedia(munA.id)
      expect(listA).toHaveLength(1)
      expect(listA[0].munId).toBe(munA.id)
    })
  })

  describe('deleteMunMedia', () => {
    it('lets the owning organizer delete a media row', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)
      const media = await uploadMunMedia(
        { munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' },
        session,
      )

      await deleteMunMedia(media.id, session)

      const [row] = await db.select().from(munMedia).where(eq(munMedia.id, media.id)).limit(1)
      expect(row).toBeUndefined()
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)
      const media = await uploadMunMedia(
        { munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' },
        sessionFor(owner),
      )

      await expect(deleteMunMedia(media.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    })
  })

  describe('reorderGallery', () => {
    it('lets the owning organizer reorder gallery images', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const first = await uploadMunMedia({ munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' }, session)
      const second = await uploadMunMedia({ munId: mun.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' }, session)

      await reorderGallery(mun.id, [second.id, first.id], session)

      const [firstRow] = await db.select().from(munMedia).where(eq(munMedia.id, first.id))
      const [secondRow] = await db.select().from(munMedia).where(eq(munMedia.id, second.id))
      expect(secondRow.displayOrder).toBe(0)
      expect(firstRow.displayOrder).toBe(1)
    })

    it('rejects a non-owning organizer with Forbidden', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id)

      await expect(reorderGallery(mun.id, [], sessionFor(stranger))).rejects.toThrow('Forbidden')
    })

    it('rejects the whole reorder when one id belongs to a different mun (IDOR), rather than silently reordering the valid subset', async () => {
      const organizer = await makeUser('ORGANIZER')
      const munA = await makeMun(organizer.id)
      const munB = await makeMun(organizer.id)
      const session = sessionFor(organizer)

      const ownItem = await uploadMunMedia(
        { munId: munA.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' },
        session,
      )
      const foreignItem = await uploadMunMedia(
        { munId: munB.id, kind: 'GALLERY', file: PNG_BUFFER, contentType: 'image/png' },
        session,
      )

      await expect(reorderGallery(munA.id, [foreignItem.id, ownItem.id], session)).rejects.toThrow(
        'One or more ids do not belong to this mun',
      )

      // The valid item's displayOrder must be untouched — the whole call
      // rejected, it did not partially succeed on the subset that was valid.
      const [ownRow] = await db.select().from(munMedia).where(eq(munMedia.id, ownItem.id))
      expect(ownRow.displayOrder).toBe(0)
    })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
