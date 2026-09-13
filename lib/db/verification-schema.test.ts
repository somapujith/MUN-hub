import { afterAll, describe, expect, it } from 'vitest'
import { db } from './client'
import { muns, users, munModuleVerifications, verificationIssues, organizerConfirmations, munVersions } from './schema'

describe('verification schema tables', () => {
  it('can insert and read a mun_module_verifications row', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Schema Test Mun', slug: `schema-test-${Date.now()}-${Math.random()}` })
      .returning()

    const [row] = await db
      .insert(munModuleVerifications)
      .values({ munId: mun.id, moduleName: 'committees', state: 'NOT_SUBMITTED' })
      .returning()

    expect(row.state).toBe('NOT_SUBMITTED')
  })

  it('can insert a verification_issues row with severity', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org2', email: `org2-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [reviewer] = await db
      .insert(users)
      .values({ name: 'Rev', email: `rev-${Date.now()}-${Math.random()}@test.com`, role: 'OPERATIONS' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Issue Mun', slug: `issue-mun-${Date.now()}-${Math.random()}` })
      .returning()

    const [issue] = await db
      .insert(verificationIssues)
      .values({ munId: mun.id, moduleName: 'mun_details', severity: 'BLOCKER', reason: 'Missing venue address', raisedBy: reviewer.id })
      .returning()

    expect(issue.severity).toBe('BLOCKER')
    expect(issue.resolved).toBe(false)
  })

  it('can insert organizer_confirmations and mun_versions rows with a jsonb snapshot', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org3', email: `org3-${Date.now()}-${Math.random()}@test.com`, role: 'ORGANIZER' })
      .returning()
    const [mun] = await db
      .insert(muns)
      .values({ organizerId: organizer.id, name: 'Version Mun', slug: `version-mun-${Date.now()}-${Math.random()}` })
      .returning()

    const [confirmation] = await db
      .insert(organizerConfirmations)
      .values({ munId: mun.id, confirmingUserId: organizer.id, versionNumber: 1, snapshotJson: { name: mun.name } })
      .returning()
    expect(confirmation.versionNumber).toBe(1)

    const [version] = await db
      .insert(munVersions)
      .values({ munId: mun.id, versionNumber: 1, snapshotJson: { name: mun.name } })
      .returning()
    expect(version.snapshotJson).toEqual({ name: mun.name })
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
