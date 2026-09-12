import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from './client'
import { muns, users } from './schema'
import { assertMunExists } from './tenant-guard'

describe('tenant-guard', () => {
  let munId: string

  beforeAll(async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Test Mun',
        slug: `test-mun-${Date.now()}`,
      })
      .returning()

    munId = mun.id
  })

  it('resolves an existing mun id', async () => {
    const mun = await assertMunExists(munId)
    expect(mun.id).toBe(munId)
  })

  it('throws for a non-existent mun id', async () => {
    await expect(assertMunExists('does-not-exist')).rejects.toThrow('Mun not found')
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
