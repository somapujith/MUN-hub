import { expect, test } from '@playwright/test'
import { getMun } from '../../fixtures/api'
import { withFixtureDb } from '../../fixtures/fixture-db'
import { OPEN } from '../../fixtures/fixture-muns'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { achievements, certificates } from '../../../lib/db/schema'
import { freshStudentPage, main, registerOnOpenMun } from './_helpers'

/** Delegate's certificates & achievements page, and the sidebar entries that lead to it. */

test.use({ storageState: { cookies: [], origins: [] } })

const CERTIFICATE_LINK = 'https://files.example.test/e2e-certificate.pdf'

test.describe('certificates & achievements page', () => {
  test('a delegate with nothing issued sees two empty states', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    await page.goto('/dashboard/achievements')

    await expect(pageHeading(page)).toHaveText('Certificates & achievements')
    await expect(main(page)).toContainText('No verified awards yet')
    await expect(main(page)).toContainText('No certificates yet')
    crashes.assertNone()
    await context.close()
  })

  test('shows verified awards and certificates, hides unverified awards, and never leaks another delegate\'s', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const other = await freshStudentPage(browser)
    const mun = await getMun(session.api, OPEN.slug)
    const registrationId = await registerOnOpenMun(session, { pay: true })
    const otherRegistrationId = await registerOnOpenMun(other.session, { pay: true })

    await withFixtureDb(async (db) => {
      await db.insert(achievements).values([
        { userId: session.userId, munId: mun.id, registrationId, committee: 'E2E General Assembly', portfolio: 'France', award: 'Best Delegate', verificationStatus: 'verified' },
        { userId: session.userId, munId: mun.id, registrationId, award: 'Still Only A Draft' },
        { userId: other.session.userId, munId: mun.id, registrationId: otherRegistrationId, award: 'Belongs To Someone Else', verificationStatus: 'verified' },
      ])
      await db.insert(certificates).values([
        { userId: session.userId, munId: mun.id, registrationId, certificateUrl: CERTIFICATE_LINK, verificationStatus: 'verified' },
        { userId: session.userId, munId: mun.id, registrationId, certificateUrl: null },
        { userId: other.session.userId, munId: mun.id, registrationId: otherRegistrationId, certificateUrl: 'https://files.example.test/not-yours.pdf' },
      ])
    })

    const crashes = watchForCrashes(page)
    await page.goto('/dashboard/achievements')
    const content = main(page)

    const awards = content.getByRole('region', { name: 'Achievements' })
    await expect(awards.getByRole('heading', { level: 3, name: 'Best Delegate' })).toBeVisible()
    await expect(awards).toContainText(OPEN.name)
    await expect(awards).toContainText('E2E General Assembly · France')
    await expect(awards).toContainText('Verified')
    await expect(content).not.toContainText('Still Only A Draft')
    await expect(content).not.toContainText('Belongs To Someone Else')

    const certs = content.getByRole('region', { name: 'Certificates' })
    const download = certs.getByRole('button', { name: /download/i })
    await expect(download).toHaveCount(1)
    await expect(download).toHaveAttribute('href', CERTIFICATE_LINK)
    await expect(download).toHaveAttribute('target', '_blank')
    await expect(download).toHaveAttribute('rel', /noopener/)
    await expect(certs).toContainText('Awaiting verification')
    await expect(certs).toContainText('File not available yet')
    await expect(content).not.toContainText('not-yours')
    crashes.assertNone()

    await context.close()
    await other.context.close()
  })

  test('a signed-out visitor is sent to sign in', async ({ page }) => {
    await page.goto('/dashboard/achievements')
    await expect(page).toHaveURL(/\/login/)
  })

  test('the dashboard links to the page', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    await page.goto('/dashboard')
    await main(page).getByRole('button', { name: 'Certificates & achievements' }).click()
    await expect(page).toHaveURL(/\/dashboard\/achievements$/)
    await context.close()
  })
})

test.describe('sidebar', () => {
  test('a delegate sees a working Certificates & achievements link and a locked MUN Passport', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    await page.goto('/muns')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const menu = page.getByRole('dialog')

    const passport = menu.locator('[aria-disabled="true"]', { hasText: 'MUN Passport' })
    await expect(passport).toBeVisible()
    await expect(passport).toContainText('Locked')
    // Locked means it isn't a link at all.
    await expect(menu.getByRole('link', { name: /MUN Passport/ })).toHaveCount(0)

    await menu.getByRole('link', { name: 'Certificates & achievements' }).click()
    await expect(page).toHaveURL(/\/dashboard\/achievements$/)
    await expect(pageHeading(page)).toHaveText('Certificates & achievements')
    await context.close()
  })

  test('a signed-out visitor sees MUN Passport locked, without the delegate-only link', async ({ page }) => {
    await page.goto('/muns')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const menu = page.getByRole('dialog')

    await expect(menu.locator('[aria-disabled="true"]', { hasText: 'MUN Passport' })).toContainText('Locked')
    await expect(menu.getByRole('link', { name: 'Certificates & achievements' })).toHaveCount(0)
  })
})
