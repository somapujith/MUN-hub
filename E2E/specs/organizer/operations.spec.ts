import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  expectWorkspaceBug,
  main,
  openSection,
  organizerApi,
  prepareWorkspace,
  sandboxId,
} from './_helpers'

/**
 * The thinner workspace sections: Team (placeholder), Communications
 * (read-only directory), Results & Awards (manual entry), Certificates
 * (read-only). Registration-backed behaviour of Communications/Results is
 * covered in registrations.spec against the open fixture.
 */

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  await api?.dispose()
})

async function open(page: Page, segment: string, heading: string) {
  await prepareWorkspace(page, api)
  await openSection(page, munId, segment, heading)
}

test.describe('Team & Permissions', () => {
  test('renders its placeholder', async ({ page }) => {
    expectWorkspaceBug()
    await open(page, 'team', 'Team & Permissions')
    await expect(main(page)).toContainText('Co-organizers and role-based permissions.')
    await expect(main(page)).toContainText('Presentational shell')
  })

  test.fixme('invite co-organizers and assign roles', async () => {
    // Organizer Dashboard PRD "Team & Permissions": sub-organizer roles are
    // not built (section is a placeholder; no mun_team_members backend).
  })
})

test.describe('Communications', () => {
  test('shows the delegate directory filters and an empty state for a MUN with no delegates', async ({ page }) => {
    expectWorkspaceBug()
    await open(page, 'communications', 'Communications')
    await expect(main(page).getByLabel('Committee')).toBeVisible()
    await expect(main(page).getByLabel('Committee').getByRole('option', { name: 'E2E Sandbox Committee' })).toHaveCount(1)
    await expect(main(page).getByLabel('Payment status')).toBeVisible()
    await expect(main(page).getByRole('heading', { name: 'No delegates match these filters' })).toBeVisible()
    await main(page).getByRole('button', { name: /copy .*emails?/i }).click()
    await expect(page.getByRole('region', { name: /notifications/i })).toContainText('No delegates match these filters')
  })

  test.fixme('compose and send announcements or templated emails to delegates', async () => {
    // Organizer Dashboard PRD "Communications": no templates, compose or send
    // pipeline exists — the section is a read-only directory.
  })
})

test.describe('Results & Awards', () => {
  test('shows the empty state and the award form', async ({ page }) => {
    expectWorkspaceBug()
    await open(page, 'results', 'Results & Awards')
    await expect(main(page).getByRole('heading', { name: 'No awards recorded yet' })).toBeVisible()
    await main(page).getByRole('button', { name: 'Add award' }).first().click()
    const form = main(page).locator('form')
    await expect(form.getByLabel('Delegate')).toBeVisible()
    await expect(form.getByLabel('Delegate').getByRole('option')).toHaveText(['Select a delegate'])
    await form.evaluate((el) => el.setAttribute('novalidate', ''))
    await form.getByRole('button', { name: 'Add award' }).click()
    await expect(page.getByRole('region', { name: /notifications/i })).toContainText('Select a delegate')
  })

  test('the API refuses an award for a registration outside this MUN', async () => {
    const res = await api.post(`organizer/muns/${munId}/achievements`, {
      data: { registrationId: crypto.randomUUID(), award: 'Best Delegate' },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
    expect(await (await api.get(`organizer/muns/${munId}/achievements`)).json()).toEqual([])
  })
})

test.describe('Certificates', () => {
  test('is a read-only list with an empty state', async ({ page }) => {
    expectWorkspaceBug()
    await open(page, 'certificates', 'Certificates')
    await expect(main(page).getByRole('heading', { name: 'No certificates yet' })).toBeVisible()
    await expect(main(page).getByRole('button')).toHaveCount(0)
    expect((await api.get(`muns/${munId}/certificates`)).status()).toBe(200)
  })

  test.fixme('generate and issue certificates after the conference', async () => {
    // Deliberately deferred (Phase 2+ per CLAUDE.md); the section is read-only.
  })
})
