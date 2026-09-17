import { expect, test, type Page } from '@playwright/test'
import { adminApi } from '../admin/_helpers'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { anonApi, createFreshOrganizer, main, organizerApi, ownedMuns, sandboxId, uid } from './_helpers'
import { SANDBOX } from '../../fixtures/fixture-muns'

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

interface TicketPage {
  results: Ticket[]
  total: number
}

function conversationList(page: Page) {
  return main(page).getByRole('region', { name: 'Your conversations' })
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
  await expect(main(page)).toContainText('Pick a conversation, or send a new message to start one.')
  // The inbox is the chat, so no floating bubble here.
  await expect(page.getByRole('button', { name: /open support chat/i })).toHaveCount(0)
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

  // Opens the new thread next to the list (desktop: no back button).
  await expect(page).toHaveURL(/\/organizer\/support\?ticket=/)
  await expect(main(page).getByRole('button', { name: 'Back to conversations' })).toBeHidden()
  // The list row, the thread title and the first message bubble.
  await expect(main(page).getByText(message)).toHaveCount(3)
  await expect(main(page).getByRole('heading', { level: 2, name: message })).toBeVisible()
  const messages = main(page).getByRole('region', { name: 'Messages' })
  const reply = `E2E follow-up ${uid()}`
  await main(page).getByRole('textbox', { name: 'Type a message…' }).fill(reply)
  await main(page).getByRole('button', { name: 'Send message' }).click()
  await expect(messages.getByText(reply)).toBeVisible()
  await expect(messages.getByRole('listitem')).toHaveCount(2)

  const tickets: TicketPage = await (await organizer.api.get('support/conversations')).json()
  expect(tickets.total).toBe(1)
  expect(tickets.results).toHaveLength(1)
  expect(tickets.results[0]).toMatchObject({ createdBy: organizer.userId, subject: message, status: 'NEW', category: 'GENERAL' })
  expect(page.url()).toContain(`ticket=${tickets.results[0].id}`)

  const listItem = conversationList(page).getByRole('listitem').filter({ hasText: tickets.results[0].subject })
  await expect(listItem).toBeVisible()
  await expect(listItem).toContainText('Received')

  // Survives a reload, deep link included.
  await page.reload()
  await expect(conversationList(page).getByRole('listitem').filter({ hasText: tickets.results[0].subject })).toBeVisible()
  await expect(messages.getByText(reply)).toBeVisible()

  // A staff reply shows up as "Waiting on you" for the organizer.
  const admin = await adminApi()
  expect((await admin.post(`support/conversations/${tickets.results[0].id}/messages`, { data: { body: 'Send us the new IFSC.' } })).status()).toBe(201)
  await admin.dispose()
  await page.reload()
  await expect(messages).toContainText('Send us the new IFSC.')
  await expect(messages.getByRole('listitem').filter({ hasText: 'Send us the new IFSC.' })).toContainText('MUN Hub support')
  await expect(listItem).toContainText('Waiting on you')
  await context.close()
  await organizer.api.dispose()
})

test('below the lg breakpoint the thread has a back button to the list', async ({ browser }) => {
  const organizer = await createFreshOrganizer('E2E Support Narrow Organizer')
  const message = `E2E narrow organizer thread ${uid()}`
  const started = await organizer.api.post('support/conversations', { data: { body: message } })
  expect(started.status(), await started.text()).toBe(201)
  const { ticket } = (await started.json()) as { ticket: Ticket }

  const context = await browser.newContext({ storageState: await organizer.api.storageState(), viewport: { width: 800, height: 900 } })
  const page = await context.newPage()
  await page.goto(`/organizer/support?ticket=${ticket.id}`)
  await expect(conversationList(page)).toBeHidden()
  const back = main(page).getByRole('button', { name: 'Back to conversations' })
  await back.click()
  await expect(conversationList(page).getByRole('listitem').filter({ hasText: message })).toBeVisible()
  await expect(page).toHaveURL(/\/organizer\/support$/)
  await context.close()
  await organizer.api.dispose()
})

test('the full support form lets an organizer pick one of their conferences, and lands on the thread', async ({ page }) => {
  const api = await organizerApi()
  const munId = await sandboxId(api)
  const subject = `E2E organizer form ticket ${uid()}`
  await page.goto('/support/new')
  const form = main(page)
  await expect(form.getByLabel('Category')).toHaveValue('ORGANIZER')
  await expect(form.getByLabel('Category')).not.toContainText(/refund/i)
  await form.getByLabel('Conference (optional)').selectOption({ label: SANDBOX.name })
  await form.getByLabel('Subject').fill(subject)
  await form.getByLabel('Describe the issue').fill('Our sandbox needs a hand.')
  await form.getByRole('button', { name: 'Submit' }).click()

  await expect(page).toHaveURL(/\/organizer\/support\?ticket=/)
  const ticketId = new URL(page.url()).searchParams.get('ticket')!
  await expect(main(page).getByRole('heading', { level: 2, name: subject })).toBeVisible()
  // The conference is named next to the category.
  await expect(main(page).getByText(`${SANDBOX.name} · Organizer tools`).first()).toBeVisible()

  const detail = await (await api.get(`support/conversations/${ticketId}`)).json()
  expect(detail.ticket).toMatchObject({ subject, category: 'ORGANIZER', relatedMunId: munId })
  expect(detail.messages.map((m: { body: string }) => m.body)).toEqual(['Our sandbox needs a hand.'])
  await api.dispose()
})

test('the chat composer can tie a new conversation to one of the organizer\'s conferences', async ({ page }) => {
  const api = await organizerApi()
  const munId = await sandboxId(api)
  const message = `E2E composer about sandbox ${uid()}`
  await page.goto('/organizer/support')
  await main(page).getByLabel('Which conference is this about?').selectOption({ label: `About ${SANDBOX.name}` })
  await main(page).getByRole('textbox', { name: 'Message our support team…' }).fill(message)
  await main(page).getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page).toHaveURL(/\?ticket=/)
  const ticketId = new URL(page.url()).searchParams.get('ticket')!
  const detail = await (await api.get(`support/conversations/${ticketId}`)).json()
  expect(detail.ticket).toMatchObject({ subject: message, relatedMunId: munId })
  await api.dispose()
})

test('the floating support chat is available inside the workspace', async ({ page }) => {
  await page.goto('/organizer/dashboard')
  await page.getByRole('button', { name: 'Open support chat' }).click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Message our support team…' })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Open full inbox' })).toHaveAttribute('href', '/organizer/support')
})

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('the organizer inbox sends a signed-out visitor to sign in', async ({ page }) => {
    const supportCalls: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/support/')) supportCalls.push(r.url())
    })
    await page.goto('/organizer/support')
    await expect(page).toHaveURL(/\/login|\/organizer\/login/)
    await expect(page.getByRole('textbox', { name: 'Message our support team…' })).toHaveCount(0)
    expect(supportCalls).toEqual([])
  })
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
    expect(ticket).toMatchObject({ subject, category: 'ORGANIZER', relatedMunId: munId, status: 'NEW' })

    const stranger = await createFreshOrganizer()
    expect((await stranger.api.get(`support/conversations/${ticket.id}`)).status()).toBe(403)
    const sneakyReply = await stranger.api.post(`support/conversations/${ticket.id}/messages`, { data: { body: 'hi' } })
    expect(sneakyReply.status()).toBe(403)
    expect((await stranger.api.post(`support/conversations/${ticket.id}/read`)).status()).toBe(403)
    await stranger.api.dispose()

    const anon = await anonApi()
    expect((await anon.post('support/tickets', { data: { category: 'ORGANIZER', subject: 'x', description: 'y' } })).status()).toBe(401)
    expect((await anon.get('support/conversations')).status()).toBe(401)
    await anon.dispose()

    // Organizers are not support staff.
    expect((await api.get('admin/support/tickets')).status()).toBe(403)
    expect((await api.post(`admin/support/tickets/${ticket.id}/assign`)).status()).toBe(403)
    expect((await api.patch(`admin/support/tickets/${ticket.id}`, { data: { status: 'IN_PROGRESS' } })).status()).toBe(403)
    // …and can't steer the ticket through a reply either.
    const steer = await api.post(`support/conversations/${ticket.id}/messages`, { data: { body: 'x', nextStatus: 'IN_PROGRESS' } })
    expect(steer.status()).toBe(403)
    await api.dispose()
  })

  test('an organizer cannot attach a conference they do not own', async () => {
    const stranger = await createFreshOrganizer('E2E Support Stranger')
    const api = await organizerApi()
    const munId = await sandboxId(api)
    await api.dispose()
    for (const [path, data] of [
      ['support/tickets', { category: 'ORGANIZER', subject: `E2E foreign mun ${uid()}`, description: 'x', relatedMunId: munId }],
      ['support/conversations', { body: `E2E foreign mun ${uid()}`, relatedMunId: munId }],
    ] as const) {
      const res = await stranger.api.post(path, { data })
      expect([403, 404], `${path}: ${res.status()}`).toContain(res.status())
    }
    expect(((await (await stranger.api.get('support/conversations')).json()) as TicketPage).total).toBe(0)
    await stranger.api.dispose()
  })

  test('conversation lists are paginated', async () => {
    const organizer = await createFreshOrganizer('E2E Support Pager')
    for (let i = 0; i < 3; i += 1) {
      expect((await organizer.api.post('support/conversations', { data: { body: `E2E page ${i} ${uid()}` } })).status()).toBe(201)
    }
    const first: TicketPage = await (await organizer.api.get('support/conversations?limit=2')).json()
    expect(first.total).toBe(3)
    expect(first.results).toHaveLength(2)
    // Newest first.
    expect(first.results[0].subject).toMatch(/^E2E page 2 /)
    const second: TicketPage = await (await organizer.api.get('support/conversations?limit=2&offset=2')).json()
    expect(second.results.map((t) => t.subject)).toEqual([expect.stringMatching(/^E2E page 0 /)])
    expect((await organizer.api.get('support/conversations?limit=0')).status()).toBe(400)
    expect((await organizer.api.get('support/conversations?limit=1000')).status()).toBe(400)
    expect((await organizer.api.get('support/conversations?sort=asc')).status()).toBe(400)
    await organizer.api.dispose()
  })

  test('a ticket needs a known category, a subject and a description', async () => {
    const api = await organizerApi()
    for (const data of [
      { category: 'COMPLAINTS', subject: 'x', description: 'y' },
      { category: 'REFUND', subject: 'x', description: 'y' },
      { category: 'ORGANIZER', subject: '', description: 'y' },
      { category: 'ORGANIZER', subject: 'x' },
      { category: 'ORGANIZER', subject: 'x', description: 'y', relatedMunId: 'not-a-uuid' },
      { body: '' },
    ]) {
      expect((await api.post('support/tickets', { data })).status(), JSON.stringify(data)).toBe(400)
    }
    expect((await api.post('support/conversations', { data: { body: '' } })).status()).toBe(400)
    expect((await api.post('support/conversations', { data: { body: 'b'.repeat(5001) } })).status()).toBe(400)
    // The organizer still owns the MUNs this spec relies on.
    expect((await ownedMuns(api)).some((m) => m.slug === SANDBOX.slug)).toBe(true)
    await api.dispose()
  })
})
