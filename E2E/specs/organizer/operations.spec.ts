import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPS } from '../../fixtures/fixture-muns'
import { recreateOpsMun } from '../../fixtures/ops-fixture-db'
import { expectNoEmail, waitForEmail } from '../../fixtures/outbox'
import { watchForCrashes } from '../../fixtures/ui'
import { registerOnOpenMun } from '../student/_helpers'
import {
  main,
  openSection,
  organizerApi,
  sandboxId,
  toast,
  uid,
} from './_helpers'

/**
 * The thinner workspace sections: Team (placeholder), Communications
 * (composer; sending runs against the ops fixture MUN), Results & Awards
 * (manual entry), Certificates (read-only). Conference-day behaviour of
 * messages, attendance and results is covered in conference-ops.spec.
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
  await openSection(page, munId, segment, heading)
}

test.describe('Team & Permissions', () => {
  test('renders its placeholder', async ({ page }) => {
    await open(page, 'team', 'Team & Permissions')
    await expect(main(page)).toContainText('Co-organizers and role-based permissions.')
    await expect(main(page)).toContainText("This section isn't available yet")
  })

  test.fixme('invite co-organizers and assign roles', async () => {
    // Organizer Dashboard PRD "Team & Permissions": sub-organizer roles are
    // not built (section is a placeholder; no mun_team_members backend).
  })
})

test.describe('Communications', () => {
  test('shows the composer, audience filters and an empty state for a MUN with no delegates', async ({ page }) => {
    await open(page, 'communications', 'Communications')
    await expect(main(page).getByLabel('Subject')).toBeVisible()
    await expect(main(page).getByLabel('Message')).toBeVisible()
    await expect(main(page).getByLabel('Delegates')).toBeVisible()
    await expect(main(page).getByLabel('Pass')).toBeVisible()
    await expect(main(page).getByLabel('Committee').getByRole('option', { name: 'E2E Sandbox Committee' })).toHaveCount(1)
    await expect(main(page).getByRole('heading', { name: 'No delegates match these filters' })).toBeVisible()
    await expect(main(page)).toContainText('Nobody to send to yet.')
    await expect(main(page).getByText('No messages sent yet.')).toBeVisible()
    await main(page).getByLabel('Subject').fill('E2E nobody')
    await main(page).getByLabel('Message').fill('Nobody should get this.')
    await expect(main(page).getByRole('button', { name: 'Send message' })).toBeDisabled()
    // The old read-only directory, its payment filter and copy-emails button are gone.
    await expect(main(page).getByLabel('Payment status')).toHaveCount(0)
    await expect(main(page).getByRole('button', { name: /copy .*emails?/i })).toHaveCount(0)
  })

  test.describe('sending', () => {
    let opsId: string
    let delegate: ApiSession

    test.beforeAll(async () => {
      // A fresh ops MUN (fixtures/ops-fixture-db.ts): its own delegate and a full hourly send quota.
      opsId = await recreateOpsMun()
      delegate = await signUpViaApi({ name: `E2E Announcement Delegate ${uid()}` })
      await registerOnOpenMun(delegate, { slug: OPS.slug, pass: OPS.products[0].name, pay: true })
    })

    test.afterAll(async () => {
      await delegate?.api.dispose()
    })

    test('compose and send an announcement to delegates', async ({ page }) => {
      const crashes = watchForCrashes(page)
      const subject = `E2E Venue change ${uid()}`
      await openSection(page, opsId, 'communications', 'Communications')
      await expect(main(page).getByText('1 delegate', { exact: true })).toBeVisible()
      await expect(main(page)).toContainText('5 messages left this hour.')

      await main(page).getByLabel('Subject').fill(subject)
      await main(page).getByLabel('Message').fill('Hi delegates,\n\nDay one moves to Hall C.')
      await expect(main(page)).toContainText(`${subject.length}/150`)
      let confirmText = ''
      page.once('dialog', (dialog) => {
        confirmText = dialog.message()
        void dialog.accept()
      })
      await main(page).getByRole('button', { name: 'Send message' }).click()
      await expect(toast(page, 'Message sent to 1 delegate')).toBeVisible()
      expect(confirmText).toBe(`Send "${subject}" to 1 delegate? This can't be undone.`)
      await expect(main(page).getByLabel('Subject')).toHaveValue('')
      await expect(main(page).getByRole('listitem').filter({ hasText: subject })).toContainText('1 recipient')
      await expect(main(page)).toContainText('4 messages left this hour.')

      const email = await waitForEmail(delegate.email, `${OPS.name}: ${subject}`)
      expect(email.text).toContain('Day one moves to Hall C.')
      crashes.assertNone()
    })

    test('dismissing the confirmation sends nothing', async ({ page }) => {
      const subject = `E2E Not sent ${uid()}`
      await openSection(page, opsId, 'communications', 'Communications')
      await expect(main(page).getByText('1 delegate', { exact: true })).toBeVisible()
      await main(page).getByLabel('Subject').fill(subject)
      await main(page).getByLabel('Message').fill('This stays a draft.')
      page.once('dialog', (dialog) => void dialog.dismiss())
      await main(page).getByRole('button', { name: 'Send message' }).click()
      await expect(main(page).getByLabel('Subject')).toHaveValue(subject)
      await expectNoEmail(delegate.email, `${OPS.name}: ${subject}`, 1_000)
      const history = (await (await api.get(`organizer/muns/${opsId}/communications`)).json()) as Array<{ subject: string }>
      expect(history.map((h) => h.subject)).not.toContain(subject)
    })
  })

  test.fixme('templated emails and scheduled announcements', async () => {
    // Organizer Dashboard PRD "Communications": plain-text messages can be
    // composed and sent, but there are no templates or scheduling.
  })
})

test.describe('Results & Awards', () => {
  test('shows the empty state and the award form', async ({ page }) => {
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
    await open(page, 'certificates', 'Certificates')
    await expect(main(page).getByRole('heading', { name: 'No certificates yet' })).toBeVisible()
    await expect(main(page).getByRole('button')).toHaveCount(0)
    expect((await api.get(`muns/${munId}/certificates`)).status()).toBe(200)
  })

  test.fixme('generate and issue certificates after the conference', async () => {
    // Deliberately deferred (Phase 2+ per CLAUDE.md); the section is read-only.
  })
})
