import { expect, test, type Page } from '@playwright/test'
import { adminApi } from '../admin/_helpers'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { freshStudentPage, main, registerOnOpenMun } from './_helpers'

/**
 * Student support: the ticket form, the inbox (list + thread side by side from
 * `lg`), and the floating chat widget. Every conversation is one ticket whose
 * opening message is the form's description.
 */

test.use({ storageState: { cookies: [], origins: [] } })

function uniqueSubject(label: string) {
  return `E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** The categories a delegate may file under. There are no refunds in this product. */
const REQUESTER_CATEGORIES = [
  'General question',
  'Registration',
  'Payment',
  'Conference info',
  'Account',
  'Certificate',
  'Organizer tools',
  'Technical issue',
  'Safety / policy',
]

function conversationList(page: Page) {
  return main(page).getByRole('region', { name: 'Your conversations' })
}

function conversationRow(page: Page, subject: string) {
  return conversationList(page).getByRole('button', { name: new RegExp(subject) })
}

/** The open thread's header (the h2 holding the subject) and the message list. */
function thread(page: Page) {
  return {
    title: main(page).getByRole('heading', { level: 2 }),
    messages: main(page).getByRole('region', { name: 'Messages' }),
    back: main(page).getByRole('button', { name: 'Back to conversations' }),
    reply: main(page).getByRole('textbox', { name: 'Type a message…' }),
    send: main(page).getByRole('button', { name: 'Send message' }),
  }
}

test.describe('support tickets', () => {
  test('a student files a ticket and lands on its conversation in the inbox', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    const subject = uniqueSubject('payment question')
    const description = 'My card was charged but the dashboard still says pending.'

    await page.goto('/support/new')
    await expect(pageHeading(page)).toHaveText('Contact Support')
    const submit = main(page).getByRole('button', { name: 'Submit' })
    await expect(submit).toBeDisabled()

    await main(page).getByLabel('Category').selectOption({ label: 'Payment' })
    await main(page).getByLabel('Subject').fill(subject)
    await main(page).getByLabel('Describe the issue').fill(description)
    await expect(submit).toBeEnabled()
    const created = page.waitForResponse((r) => r.url().endsWith('/support/tickets') && r.request().method() === 'POST')
    await submit.click()
    const ticket = (await (await created).json()) as { id: string }

    await expect(page).toHaveURL(new RegExp(`/dashboard/support\\?ticket=${ticket.id}$`))
    await expect(page.getByText("Ticket created. We'll reply in your support inbox.")).toBeVisible()
    await expect(pageHeading(page)).toHaveText('Support')

    // The thread: subject, status and the description as the first message.
    const view = thread(page)
    await expect(view.title).toHaveText(subject)
    await expect(main(page).getByText('Received', { exact: true }).first()).toBeVisible()
    await expect(view.messages.getByRole('listitem')).toHaveCount(1)
    await expect(view.messages.getByRole('listitem').first()).toContainText('You')
    await expect(view.messages.getByRole('listitem').first()).toContainText(description)
    // Desktop: list and thread side by side, so no back button.
    await expect(view.back).toBeHidden()

    // The list shows it too, selected and marked Received.
    const row = conversationRow(page, subject)
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('aria-current', 'true')
    await expect(row).toContainText('Received')
    await expect(row).toContainText('Payment')

    // Reply, and it survives a reload.
    const reply = uniqueSubject('follow-up')
    await view.reply.fill(reply)
    await view.send.click()
    await expect(view.messages.getByText(reply)).toBeVisible()
    await expect(view.reply).toHaveValue('')
    await page.reload()
    await expect(thread(page).messages.getByRole('listitem')).toHaveCount(2)
    crashes.assertNone()
    await context.close()
  })

  test('below the lg breakpoint the inbox shows the list or the thread, with a back button', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const subject = uniqueSubject('narrow inbox')
    const res = await session.api.post('support/tickets', {
      data: { category: 'ACCOUNT', subject, description: 'Checking the one-pane layout.' },
    })
    expect(res.status()).toBe(201)

    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/dashboard/support')
    const row = conversationRow(page, subject)
    await row.click()
    await expect(page).toHaveURL(/\?ticket=/)
    await expect(conversationList(page)).toBeHidden()
    await expect(thread(page).title).toHaveText(subject)
    await thread(page).back.click()
    await expect(page).not.toHaveURL(/\?ticket=/)
    await expect(conversationRow(page, subject)).toBeVisible()
    await context.close()
  })

  test('the form offers no Refund category, and the API refuses one', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await page.goto('/support/new')
    const category = main(page).getByLabel('Category')
    await expect(category.getByRole('option')).toHaveText(REQUESTER_CATEGORIES)
    await expect(category).not.toContainText(/refund/i)
    await expect(main(page)).not.toContainText(/refund/i)

    const refund = await session.api.post('support/tickets', {
      data: { category: 'REFUND', subject: 'Refund please', description: 'I want my money back.' },
    })
    expect(refund.status()).toBe(400)
    const refundChat = await session.api.post('support/conversations', { data: { body: 'Refund?', category: 'REFUND' } })
    expect(refundChat.status()).toBe(400)
    await context.close()
  })

  test('whitespace-only, over-long or unexpected input cannot be submitted', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await page.goto('/support/new')
    await main(page).getByLabel('Subject').fill('   ')
    await main(page).getByLabel('Describe the issue').fill('Something')
    await expect(main(page).getByRole('button', { name: 'Submit' })).toBeDisabled()
    // The subject box stops at 150 characters.
    await main(page).getByLabel('Subject').fill('s'.repeat(200))
    await expect(main(page).getByLabel('Subject')).toHaveValue('s'.repeat(150))

    for (const data of [
      { category: 'TECHNICAL', subject: '', description: 'x' },
      { category: 'TECHNICAL', subject: '   ', description: 'x' },
      { category: 'TECHNICAL', subject: 's'.repeat(151), description: 'x' },
      { category: 'TECHNICAL', subject: 'x', description: 'd'.repeat(5001) },
      { category: 'TECHNICAL', subject: 'x', description: 'y', status: 'RESOLVED' },
      { category: 'TECHNICAL', subject: 'x', description: 'y', createdBy: crypto.randomUUID() },
    ]) {
      const res = await session.api.post('support/tickets', { data })
      expect(res.status(), JSON.stringify(data).slice(0, 80)).toBe(400)
    }
    await context.close()
  })

  test('a student only ever sees their own tickets', async ({ browser }) => {
    const other = await freshStudentPage(browser)
    const otherSubject = uniqueSubject('someone else')
    const created = await other.session.api.post('support/tickets', {
      data: { category: 'ACCOUNT', subject: otherSubject, description: 'Private to the other student.' },
    })
    expect(created.status()).toBe(201)
    const otherTicket = (await created.json()) as { id: string }

    const { context, page, session } = await freshStudentPage(browser)
    await page.goto('/dashboard/support')
    await expect(main(page)).toContainText('No conversations yet')
    await expect(main(page)).not.toContainText(otherSubject)

    const list = await session.api.get('support/conversations')
    expect(await list.json()).toEqual({ results: [], total: 0 })
    expect((await session.api.get(`support/conversations/${otherTicket.id}`)).status()).toBe(403)
    const reply = await session.api.post(`support/conversations/${otherTicket.id}/messages`, { data: { body: 'hijack' } })
    expect(reply.status()).toBe(403)

    // Deep-linking to it shows a refusal, not the conversation.
    await page.goto(`/dashboard/support?ticket=${otherTicket.id}`)
    await expect(main(page).getByRole('alert')).toContainText("This conversation isn't available.")
    await expect(main(page)).not.toContainText('Private to the other student.')
    await other.context.close()
    await context.close()
  })

  test('a ticket can only reference the delegate\'s own registrations', async ({ browser }) => {
    const owner = await freshStudentPage(browser)
    const registrationId = await registerOnOpenMun(owner.session)
    const ownTicket = await owner.session.api.post('support/tickets', {
      data: { category: 'REGISTRATION', subject: uniqueSubject('my seat'), description: 'About my seat.', relatedRegistrationId: registrationId },
    })
    expect(ownTicket.status(), await ownTicket.text()).toBe(201)
    expect(await ownTicket.json()).toMatchObject({ relatedRegistrationId: registrationId })

    const stranger = await freshStudentPage(browser)
    const foreign = await stranger.session.api.post('support/tickets', {
      data: { category: 'REGISTRATION', subject: uniqueSubject('not mine'), description: 'x', relatedRegistrationId: registrationId },
    })
    expect([403, 404]).toContain(foreign.status())
    expect((await (await stranger.session.api.get('support/conversations')).json()).total).toBe(0)
    await owner.context.close()
    await stranger.context.close()
  })

  test('the requester sees staff replies as "MUN Hub support", never the staff member', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const subject = uniqueSubject('staff identity')
    const { id } = (await (
      await session.api.post('support/tickets', { data: { category: 'GENERAL', subject, description: 'Hello?' } })
    ).json()) as { id: string }
    const admin = await adminApi()
    const staffReply = `We are on it (${Date.now()})`
    expect((await admin.post(`support/conversations/${id}/messages`, { data: { body: staffReply } })).status()).toBe(201)
    await admin.dispose()

    const detail = await (await session.api.get(`support/conversations/${id}`)).json()
    expect(detail.viewer).toBe('REQUESTER')
    expect(detail.ticket.status).toBe('WAITING')
    for (const key of ['assignedTo', 'adminReadAt', 'requesterEmail']) expect(detail.ticket).not.toHaveProperty(key)
    const staffMessage = detail.messages.find((m: { body: string }) => m.body === staffReply)
    expect(staffMessage).toMatchObject({ author: 'STAFF', senderId: null })
    expect(staffMessage.senderName ?? null).toBeNull()

    await page.goto(`/dashboard/support?ticket=${id}`)
    const bubble = thread(page).messages.getByRole('listitem').filter({ hasText: staffReply })
    await expect(bubble).toContainText('MUN Hub support')
    await expect(main(page).getByText('Waiting on you', { exact: true }).first()).toBeVisible()
    await expect(main(page)).not.toContainText('Admin')

    // Answering puts the ticket back in the team's court.
    await thread(page).reply.fill('Thanks, here are the details.')
    await thread(page).send.click()
    await expect(main(page).getByText('In progress', { exact: true }).first()).toBeVisible()
    await context.close()
  })

  test('support pages require sign-in', async ({ page }) => {
    await page.goto('/support/new')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsupport%2Fnew/)
    await page.goto('/dashboard/support')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard%2Fsupport/)
  })

  test('the account menu links to the support inbox', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    await page.goto('/muns')
    await page.getByRole('button', { name: /account menu/i }).click()
    await page.getByRole('menuitem', { name: 'Support' }).click()
    await expect(page).toHaveURL(/\/dashboard\/support$/)
    await expect(pageHeading(page)).toHaveText('Support')
    // The inbox is the full-page chat, so the floating bubble isn't offered here.
    await expect(page.getByRole('button', { name: /open support chat/i })).toHaveCount(0)
    await context.close()
  })
})

test.describe('support widget', () => {
  test('the open panel is wide enough to use on a desktop screen', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    await page.goto('/muns')
    await page.getByRole('button', { name: 'Open support chat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Support' })
    await expect(dialog).toBeVisible()
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(300)
    await expect(dialog.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
    await context.close()
  })

  test('opens and closes, and starting a conversation opens its thread', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    // Below the `sm` breakpoint the sheet is full-width.
    await page.setViewportSize({ width: 600, height: 800 })
    const unread = page.waitForResponse((r) => r.url().includes('/support/conversations/unread-count'))
    await page.goto('/muns')
    expect((await unread).status()).toBe(200)
    expect(await (await unread).json()).toEqual({ count: 0 })

    const trigger = page.getByRole('button', { name: 'Open support chat' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Support' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Open full inbox' })).toHaveAttribute('href', '/dashboard/support')
    await expect(dialog).toContainText('No conversations yet')
    const send = dialog.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toBeDisabled()

    const message = uniqueSubject('widget hello')
    await dialog.getByRole('textbox', { name: 'Message our support team…' }).fill(message)
    await send.click()
    // In the widget the thread replaces the list, so the back button is always there.
    await expect(dialog.getByRole('button', { name: 'Back to conversations' })).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Messages' })).toContainText(message)
    await expect(dialog.getByText('Received', { exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Back to conversations' }).click()
    await expect(dialog.getByRole('button', { name: new RegExp(message) })).toBeVisible()

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await context.close()
  })

  test('Enter sends and Shift+Enter adds a new line', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await page.goto('/muns')
    await page.getByRole('button', { name: 'Open support chat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Support' })
    const box = dialog.getByRole('textbox', { name: 'Message our support team…' })
    const first = uniqueSubject('line one')
    await box.fill(first)
    await box.press('Shift+Enter')
    await box.pressSequentially('line two')
    await expect(box).toHaveValue(`${first}\nline two`)
    await box.press('Enter')
    await expect(dialog.getByRole('region', { name: 'Messages' })).toContainText('line two')

    const { results } = await (await session.api.get('support/conversations')).json()
    expect(results).toHaveLength(1)
    const detail = await (await session.api.get(`support/conversations/${results[0].id}`)).json()
    expect(detail.messages.map((m: { body: string }) => m.body)).toEqual([`${first}\nline two`])
    await context.close()
  })

  test('an unread staff reply shows on the bubble and clears once read', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    const subject = uniqueSubject('unread badge')
    const { id } = (await (
      await session.api.post('support/tickets', { data: { category: 'GENERAL', subject, description: 'Ping' } })
    ).json()) as { id: string }
    const admin = await adminApi()
    expect((await admin.post(`support/conversations/${id}/messages`, { data: { body: 'Pong' } })).status()).toBe(201)
    await admin.dispose()
    expect(await (await session.api.get('support/conversations/unread-count')).json()).toEqual({ count: 1 })

    await page.goto('/muns')
    const trigger = page.getByRole('button', { name: 'Open support chat (1 unread)' })
    await expect(trigger).toBeVisible()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Support' })
    const row = dialog.getByRole('button', { name: new RegExp(subject) })
    await expect(row).toContainText('New reply from support')
    await row.click()
    await expect(dialog.getByRole('region', { name: 'Messages' })).toContainText('Pong')
    await expect.poll(async () => (await (await session.api.get('support/conversations/unread-count')).json()).count).toBe(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open support chat', exact: true })).toBeVisible()
    await context.close()
  })

  test('signed-out visitors get a sign-in prompt and no support API calls', async ({ page }) => {
    const supportCalls: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/support/')) supportCalls.push(r.url())
    })
    await page.goto('/muns')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Open support chat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Support' })
    await expect(dialog.getByText('Sign in to chat with us')).toBeVisible()
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    await expect(dialog.getByRole('link', { name: 'Open full inbox' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Organizer sign-in' })).toBeVisible()
    await expect(dialog.getByRole('link', { name: /@/ })).toHaveAttribute('href', /^mailto:/)

    await dialog.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fmuns/)
    expect(supportCalls).toEqual([])
  })
})
