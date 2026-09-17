import { expect, test } from '@playwright/test'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { anonApi, createFreshOrganizer, main, organizerApi, sandboxId, uid } from './_helpers'

/**
 * Organizer support (Organizer Dashboard PRD: help & support). Uses a fresh
 * organizer for the chat flow so the conversation list starts empty and
 * other runs' tickets can't interfere.
 */

interface Ticket {
  id: string
  subject: string
  status: string
  category: string
  relatedMunId: string | null
  createdBy: string
}

test('the organizer support page loads with a composer', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await page.goto('/organizer/support')
  await expect(pageHeading(page)).toHaveText('Support')
  await expect(main(page)).toContainText('Chat with our team about your MUN listing, payments, or anything else.')
  const composer = main(page).getByRole('textbox', { name: 'Message our support team…' })
  await expect(composer).toBeVisible()
  await expect(main(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await composer.fill('   ')
  await expect(main(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  crashes.assertNone()
})

test('an organizer starts a support conversation, replies, and finds it in their list', async ({ browser }) => {
  const organizer = await createFreshOrganizer('E2E Support Organizer')
  const context = await browser.newContext({ storageState: await organizer.api.storageState() })
  const page = await context.newPage()
  const message = `E2E: our payout details need changing (${uid()})`

  await page.goto('/organizer/support')
  await expect(main(page)).toContainText('No conversations yet')
  await main(page).getByRole('textbox', { name: 'Message our support team…' }).fill(message)
  await main(page).getByRole('button', { name: 'Send', exact: true }).click()

  // Opens the new thread.
  await expect(main(page).getByRole('button', { name: 'Back to conversations' })).toBeVisible()
  // Once as the thread title, once as the first message bubble.
  await expect(main(page).getByText(message)).toHaveCount(2)
  const reply = `E2E follow-up ${uid()}`
  await main(page).getByRole('textbox', { name: 'Type a message…' }).fill(reply)
  await main(page).getByRole('button', { name: 'Send message' }).click()
  await expect(main(page).getByText(reply)).toBeVisible()

  const tickets: Ticket[] = await (await organizer.api.get('support/conversations')).json()
  expect(tickets).toHaveLength(1)
  expect(tickets[0].createdBy).toBe(organizer.userId)

  await main(page).getByRole('button', { name: 'Back to conversations' }).click()
  const listItem = main(page).getByRole('listitem').filter({ hasText: tickets[0].subject })
  await expect(listItem).toBeVisible()
  await listItem.getByRole('button').click()
  await expect(main(page).getByText(reply)).toBeVisible()

  // Survives a reload.
  await page.reload()
  await expect(main(page).getByRole('listitem').filter({ hasText: tickets[0].subject })).toBeVisible()
  await context.close()
  await organizer.api.dispose()
})

test('the floating support chat is available inside the workspace', async ({ page }) => {
  await page.goto('/organizer/dashboard')
  await page.getByRole('button', { name: 'Open support chat' }).click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Message our support team…' })).toBeVisible()
})

test.describe('support API', () => {
  test('an organizer raises a ticket about their MUN and only they can read it', async () => {
    const api = await organizerApi()
    const munId = await sandboxId(api)
    const subject = `E2E settlement question ${uid()}`
    const res = await api.post('support/tickets', {
      data: { category: 'ORGANIZER', subject, description: 'When are settlements paid out?', relatedMunId: munId },
    })
    expect(res.status(), await res.text()).toBe(201)
    const ticket: Ticket = await res.json()
    expect(ticket).toMatchObject({ subject, category: 'ORGANIZER', relatedMunId: munId })

    const stranger = await createFreshOrganizer()
    expect([403, 404]).toContain((await stranger.api.get(`support/conversations/${ticket.id}`)).status())
    const sneakyReply = await stranger.api.post(`support/conversations/${ticket.id}/messages`, { data: { body: 'hi' } })
    expect([403, 404]).toContain(sneakyReply.status())
    await stranger.api.dispose()

    const anon = await anonApi()
    expect((await anon.post('support/tickets', { data: { category: 'ORGANIZER', subject: 'x', description: 'y' } })).status()).toBe(401)
    await anon.dispose()

    // Organizers are not support staff.
    expect((await api.get('admin/support/tickets')).status()).toBe(403)
    await api.dispose()
  })

  test('a ticket needs a known category, a subject and a description', async () => {
    const api = await organizerApi()
    for (const data of [
      { category: 'COMPLAINTS', subject: 'x', description: 'y' },
      { category: 'ORGANIZER', subject: '', description: 'y' },
      { category: 'ORGANIZER', subject: 'x' },
      { body: '' },
    ]) {
      expect((await api.post('support/tickets', { data })).status(), JSON.stringify(data)).toBe(400)
    }
    expect((await api.post('support/conversations', { data: { body: '' } })).status()).toBe(400)
    await api.dispose()
  })
})
