import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { munDocuments, munMedia, muns, users } from '@/lib/db/schema'
import type { MunStatus, Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { runWithStorageBindings } from '@/lib/storage/bindings'
import { createInMemoryKv, SAMPLE_FILES } from '@/lib/storage/in-memory-bindings'
import { uploadMunDocument } from './mun-documents'
import { uploadMunMedia } from './mun-branding'
import {
  MAX_DOCUMENTS_PER_MUN,
  MAX_MEDIA_PER_KIND,
  MAX_UPLOAD_BYTES_PER_MUN,
  UPLOAD_LIMIT_ERROR_PATTERN,
  UPLOAD_LIMIT_ERRORS,
} from './upload-limits'

async function makeUser(role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `limits-${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string, status: MunStatus = 'ONBOARDING') {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Upload Limits Mun', slug: `upload-limits-${crypto.randomUUID()}`, status })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

function mediaRow(munId: string, kind: 'GALLERY' | 'LOGO', sizeBytes = 100) {
  return { munId, kind, url: 'https://example.com/x.png', storageKey: `seed/${crypto.randomUUID()}`, contentType: 'image/png', sizeBytes }
}

function documentRow(munId: string, sizeBytes = 100) {
  return {
    munId,
    kind: 'OTHER' as const,
    title: 'Doc',
    url: 'https://example.com/x.pdf',
    storageKey: `seed/${crypto.randomUUID()}`,
    contentType: 'application/pdf',
    sizeBytes,
  }
}

const galleryUpload = (munId: string) =>
  ({ munId, kind: 'GALLERY', file: SAMPLE_FILES.png, contentType: 'image/png' }) as const
const documentUpload = (munId: string) =>
  ({ munId, kind: 'RULES', title: 'Rules', file: SAMPLE_FILES.pdf, contentType: 'application/pdf' }) as const

describe('upload limits', () => {
  describe('Gate-1 approval', () => {
    it.each<MunStatus>(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'])(
      'refuses organizer uploads while the MUN is %s, before anything is stored',
      async (status) => {
        const organizer = await makeUser('ORGANIZER')
        const mun = await makeMun(organizer.id, status)
        const kv = createInMemoryKv()

        await runWithStorageBindings({ kv }, async () => {
          await expect(uploadMunMedia(galleryUpload(mun.id), sessionFor(organizer))).rejects.toThrow(
            UPLOAD_LIMIT_ERRORS.notApproved,
          )
          await expect(uploadMunDocument(documentUpload(mun.id), sessionFor(organizer))).rejects.toThrow(
            UPLOAD_LIMIT_ERRORS.notApproved,
          )
        })

        expect(kv.entries.size).toBe(0)
        expect(await db.select().from(munMedia).where(eq(munMedia.munId, mun.id))).toEqual([])
        expect(await db.select().from(munDocuments).where(eq(munDocuments.munId, mun.id))).toEqual([])
      },
    )

    it('still rejects a stranger with Forbidden, not the approval message', async () => {
      const owner = await makeUser('ORGANIZER')
      const stranger = await makeUser('ORGANIZER')
      const mun = await makeMun(owner.id, 'SUBMITTED')
      await expect(uploadMunMedia(galleryUpload(mun.id), sessionFor(stranger))).rejects.toThrow('Forbidden')
    })

    it('lets an admin upload before approval', async () => {
      const organizer = await makeUser('ORGANIZER')
      const admin = await makeUser('ADMIN')
      const mun = await makeMun(organizer.id, 'SUBMITTED')
      await expect(uploadMunMedia(galleryUpload(mun.id), sessionFor(admin))).resolves.toMatchObject({ kind: 'GALLERY' })
    })
  })

  describe('row caps', () => {
    it('refuses a gallery image past the per-kind cap without writing the file', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await db.insert(munMedia).values(Array.from({ length: MAX_MEDIA_PER_KIND.GALLERY }, () => mediaRow(mun.id, 'GALLERY')))
      const kv = createInMemoryKv()

      await expect(
        runWithStorageBindings({ kv }, () => uploadMunMedia(galleryUpload(mun.id), sessionFor(organizer))),
      ).rejects.toThrow(UPLOAD_LIMIT_ERRORS.tooManyMedia('GALLERY'))
      expect(kv.entries.size).toBe(0)
    })

    it('still replaces a logo when one exists (LOGO/COVER never grow)', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await db.insert(munMedia).values(mediaRow(mun.id, 'LOGO'))

      await uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.png, contentType: 'image/png' }, sessionFor(organizer))
      const logos = await db.select().from(munMedia).where(eq(munMedia.munId, mun.id))
      expect(logos).toHaveLength(1)
    })

    it('refuses a document past the per-MUN cap', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await db.insert(munDocuments).values(Array.from({ length: MAX_DOCUMENTS_PER_MUN }, () => documentRow(mun.id)))

      await expect(uploadMunDocument(documentUpload(mun.id), sessionFor(organizer))).rejects.toThrow(
        UPLOAD_LIMIT_ERRORS.tooManyDocuments,
      )
    })

    it('lets only as many concurrent uploads through as the cap has room for', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await db
        .insert(munMedia)
        .values(Array.from({ length: MAX_MEDIA_PER_KIND.GALLERY - 1 }, () => mediaRow(mun.id, 'GALLERY')))
      const kv = createInMemoryKv()

      const results = await runWithStorageBindings({ kv }, () =>
        Promise.allSettled(Array.from({ length: 5 }, () => uploadMunMedia(galleryUpload(mun.id), sessionFor(organizer)))),
      )

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      for (const result of results) {
        if (result.status === 'rejected') expect(String(result.reason)).toContain(UPLOAD_LIMIT_ERRORS.tooManyMedia('GALLERY'))
      }
      const rows = await db.select().from(munMedia).where(eq(munMedia.munId, mun.id))
      expect(rows).toHaveLength(MAX_MEDIA_PER_KIND.GALLERY)
      // The refused uploads' objects were deleted again.
      expect(kv.entries.size).toBe(1)
    })
  })

  describe('byte cap', () => {
    it('refuses an upload that would take the MUN over its storage allowance', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await db.insert(munMedia).values(mediaRow(mun.id, 'GALLERY', MAX_UPLOAD_BYTES_PER_MUN - 100))
      await db.insert(munDocuments).values(documentRow(mun.id, 50))

      await expect(uploadMunDocument(documentUpload(mun.id), sessionFor(organizer))).rejects.toThrow(
        UPLOAD_LIMIT_ERRORS.storageFull,
      )
      await expect(uploadMunMedia(galleryUpload(mun.id), sessionFor(organizer))).rejects.toThrow(
        UPLOAD_LIMIT_ERRORS.storageFull,
      )
    })

    it('does not count the logo being replaced towards the allowance', async () => {
      const organizer = await makeUser('ORGANIZER')
      const mun = await makeMun(organizer.id)
      await db.insert(munMedia).values(mediaRow(mun.id, 'LOGO', MAX_UPLOAD_BYTES_PER_MUN))

      await expect(
        uploadMunMedia({ munId: mun.id, kind: 'LOGO', file: SAMPLE_FILES.png, contentType: 'image/png' }, sessionFor(organizer)),
      ).resolves.toMatchObject({ kind: 'LOGO' })
    })
  })

  it('UPLOAD_LIMIT_ERROR_PATTERN matches every message', () => {
    const messages = [
      UPLOAD_LIMIT_ERRORS.notApproved,
      UPLOAD_LIMIT_ERRORS.storageFull,
      UPLOAD_LIMIT_ERRORS.tooManyDocuments,
      ...(['LOGO', 'COVER', 'GALLERY', 'SPONSOR', 'ORGANIZER_LOGO'] as const).map(UPLOAD_LIMIT_ERRORS.tooManyMedia),
    ]
    for (const message of messages) expect(message).toMatch(UPLOAD_LIMIT_ERROR_PATTERN)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
