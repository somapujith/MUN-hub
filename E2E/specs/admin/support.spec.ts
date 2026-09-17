import { expect, test, type Page } from '@playwright/test'
import { signUpViaApi, type ApiSession } from '../../fixtures/api'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, heading, main, toast, uniqueName } from './_helpers'

/**
 * The staff support console (/admin/support): a filterable queue next to the
 * selected ticket, driven by tickets fresh delegates file. The local database
 * holds well over a thousand old tickets, so every test finds its own ticket
 * by searching for its unique subject.
 */

interface Ticket {
  id: string
  status: string
  resolutionNotes: string | null
  assignedTo?: string | null
}

interface Conversation {
  viewer: 'REQUESTER' | 'STAFF'
  ticket: Ticket
  messages: Array<{ body: string; author: 'REQUESTER' | 'STAFF'; senderId: string | null }>
}

async function fileTicket(
  student: ApiSession,
  subject: string,
  { category = 'REGISTRATION', priority = 'HIGH' }: { category?: string; priority?: string } = {},
) {
  const response = await student.api.post('support/tickets', {
    data: { category, priority, subject, description: 'I paid but my dashboard still shows payment pending.' },
  })
  expect(response.status(), await response.text()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function studentConversation(student: ApiSession, ticketId: string): Promise<Conversation> {
  const response = await student.api.get(`support/conversations/${ticketId}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as Conversation
}

async function staffTicket(ticketId: string): Promise<Ticket & Record<string, unknown>> {
  const admin = await adminApi()
  const response = await admin.get(`support/conversations/${ticketId}`)
  expect(response.status()).toBe(200)
  const body = (await response.json()) as Conversation
  await admin.dispose()
  expect(body.viewer).toBe('STAFF')
  return body.ticket as Ticket & Record<string, unknown>
}

function queue(page: Page) {
  return main(page).getByRole('region', { name: 'Ticket queue' })
}

function queueRow(page: Page, subject: string) {
  return queue(page).getByRole('button', { name: new RegExp(subject) })
}

function selected(page: Page) {
  const region = main(page).getByRole('region', { name: 'Selected ticket' })
  return {
    region,
    title: region.getByRole('heading', { level: 2 }),
    actions: region.getByRole('group', { name: 'Ticket actions' }),
    messages: region.getByRole('region', { name: 'Messages' }),
    reply: region.getByRole('textbox', { name: 'Reply to this conversation…' }),
    afterSending: region.getByRole('combobox', { name: 'After sending' }),
    send: region.getByRole('button', { name: 'Send', exact: true }),
    detail: (term: string) => region.locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]'),
  }
}

/** Opens the console filtered down to one subject, and selects that ticket. */
async function openTicket(page: Page, subject: string, status?: string) {
  await page.goto(`/admin/support?q=${encodeURIComponent(subject)}${status ? `&status=${status}` : ''}`)
  await expect(heading(page, 'Support')).toBeVisible()
  const row = queueRow(page, subject)
  await expect(row).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(/[?&]ticket=/)
  await expect(selected(page).title).toHaveText(subject)
  return row
}

test.describe('admin support console', () => {
  test('a delegate\'s ticket is taken, worked, replied to and resolved', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const studentName = uniqueName('E2E Admin Requester')
    const student = await signUpViaApi({ name: studentName })
    const subject = uniqueName('E2E Admin Ticket')
    const ticketId = await fileTicket(student, subject)

    await page.goto('/admin/support')
    await expect(heading(page, 'Support')).toBeVisible()
    const statusFilter = main(page).getByLabel('Status', { exact: true })
    await expect(statusFilter).toHaveValue('OPEN')
    await expect(statusFilter.getByRole('option', { name: 'Open (not resolved)' })).toHaveJSProperty('selected', true)
    await expect(main(page)).toContainText('Select a ticket to read and reply.')

    const search = main(page).getByRole('searchbox', { name: 'Search' })
    await search.fill(subject)
    await expect(page).toHaveURL(/[?&]q=/)
    const row = queueRow(page, subject)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(`${studentName} · Delegate · Registration`)
    await expect(row).toContainText('New')
    await expect(row).toContainText('High')
    await expect(row).toContainText('Unassigned')
    await expect(main(page).getByText(/^1 ticket($| ·)/)).toBeVisible()

    await row.click()
    const view = selected(page)
    await expect(page).toHaveURL(new RegExp(`ticket=${ticketId}`))
    await expect(row).toHaveAttribute('aria-current', 'true')
    await expect(view.title).toHaveText(subject)
    for (const badge of ['New', 'High priority', 'Registration']) {
      await expect(view.region.getByText(badge, { exact: true }).first()).toBeVisible()
    }
    await expect(view.detail('Requester')).toContainText(`${studentName} (Delegate)`)
    await expect(view.detail('Requester').getByRole('link', { name: student.email })).toHaveAttribute('href', `mailto:${student.email}`)
    await expect(view.detail('Owner')).toHaveText('Unassigned')
    await expect(view.detail('Ticket')).toHaveText(ticketId)
    // The form's description is the first message, from the requester.
    const first = view.messages.getByRole('listitem').first()
    await expect(first).toContainText(studentName)
    await expect(first).toContainText('I paid but my dashboard still shows payment pending.')
    await expect(view.region).not.toContainText('No messages yet.')
    await expect(view.actions).toContainText('Assign it (or reply) to start working on it.')
    await expect(view.actions.getByRole('button', { name: 'Resolve' })).toHaveCount(0)

    await view.actions.getByRole('button', { name: 'Assign to me' }).click()
    await expect(toast(page, 'Ticket assigned to you')).toBeVisible()
    await expect(view.detail('Owner')).toHaveText('Assigned to you')
    await expect(view.region.getByText('Assigned', { exact: true })).toBeVisible()
    await expect(row).toContainText('Assigned to you')
    await expect(view.actions.getByRole('button', { name: /assign to me|take over/i })).toHaveCount(0)
    await expect(view.actions.getByRole('button', { name: 'Resolve' })).toHaveCount(0)

    await view.actions.getByRole('button', { name: 'Mark in progress' }).click()
    await expect(toast(page, 'Ticket marked in progress')).toBeVisible()
    await expect(view.region.getByText('In progress', { exact: true })).toBeVisible()
    await expect(view.actions.getByRole('button', { name: 'Mark in progress' })).toHaveCount(0)

    // Reply, keeping the ticket in progress.
    const reply = `Thanks — we're checking with the payment provider (${Date.now()}).`
    await expect(view.send).toBeDisabled()
    await view.reply.fill(reply)
    await view.afterSending.selectOption({ label: 'Then keep in progress' })
    await view.send.click()
    const mine = view.messages.getByRole('listitem').filter({ hasText: reply })
    await expect(mine).toContainText('You')
    await expect(view.reply).toHaveValue('')
    await expect(view.region.getByText('In progress', { exact: true })).toBeVisible()

    const seen = await studentConversation(student, ticketId)
    expect(seen.ticket.status).toBe('IN_PROGRESS')
    expect(seen.messages.find((m) => m.body === reply)).toMatchObject({ author: 'STAFF', senderId: null })

    // The student answers; the thread picks it up by polling.
    const followUp = `Order ref E2E-${Date.now()}`
    expect((await student.api.post(`support/conversations/${ticketId}/messages`, { data: { body: followUp } })).status()).toBe(201)
    await expect(view.messages.getByRole('listitem').filter({ hasText: followUp })).toContainText(studentName, { timeout: 15_000 })

    // Resolve, with a required note.
    await view.actions.getByRole('button', { name: 'Resolve' }).click()
    const dialog = page.getByRole('dialog', { name: 'Resolve this ticket?' })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Confirm resolve' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Resolution notes' }).fill('   ')
    await expect(confirm).toBeDisabled()
    const notes = 'Payment webhook replayed; registration confirmed.'
    await dialog.getByRole('textbox', { name: 'Resolution notes' }).fill(notes)
    await confirm.click()
    await expect(toast(page, 'Ticket resolved')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(view.region.getByText('Resolved', { exact: true })).toBeVisible()
    await expect(view.region).toContainText(`Resolution: ${notes}`)
    await expect(view.region).toContainText('Stays resolved')
    await expect(view.actions.getByRole('button', { name: 'Reopen' })).toBeVisible()
    await expect(view.actions.getByRole('button', { name: 'Close conversation' })).toBeVisible()
    // The default "Open" filter no longer lists it once the queue refreshes.
    await page.reload()
    await expect(queueRow(page, subject)).toHaveCount(0)
    await expect(selected(page).title).toHaveText(subject)

    const conversation = await studentConversation(student, ticketId)
    expect(conversation.ticket.status).toBe('RESOLVED')
    expect(conversation.ticket.resolutionNotes).toBe(notes)

    // Assigning and resolving are both in the ticket's audit trail.
    const admin = await adminApi()
    const history = (await (await admin.get(`admin/audit/support_ticket/${ticketId}`)).json()) as Array<{ action: string; reason: string | null }>
    expect(history.map((entry) => entry.action)).toEqual(expect.arrayContaining(['TICKET_ASSIGNED', 'TICKET_RESOLVED']))
    expect(history.find((entry) => entry.action === 'TICKET_RESOLVED')?.reason).toBe(notes)
    await admin.dispose()
    crashes.assertNone()
  })

  test('replying to a new ticket takes it and leaves it waiting on the requester; their answer brings it back', async ({ page }) => {
    const student = await signUpViaApi()
    const subject = uniqueName('E2E Admin Reply Ticket')
    const ticketId = await fileTicket(student, subject, { category: 'PAYMENT', priority: 'URGENT' })
    const row = await openTicket(page, subject)
    await expect(row).toContainText('Payment')
    await expect(row).toContainText('Urgent')

    const view = selected(page)
    await expect(view.afterSending).toHaveValue('WAITING')
    await view.reply.fill('Can you share the order reference?')
    await view.reply.press('Enter')
    await expect(view.messages.getByRole('listitem').filter({ hasText: 'Can you share the order reference?' })).toContainText('You')
    await expect(view.region.getByText('Waiting on requester', { exact: true })).toBeVisible()
    await expect(view.detail('Owner')).toHaveText('Assigned to you')

    const ticket = await staffTicket(ticketId)
    expect(ticket).toMatchObject({ status: 'WAITING', assigneeName: expect.any(String) })

    // The requester answers: back in progress, and marked unread for staff.
    expect((await student.api.post(`support/conversations/${ticketId}/messages`, { data: { body: 'Ref E2E-123' } })).status()).toBe(201)
    expect((await staffTicket(ticketId)).status).toBe('IN_PROGRESS')
    await page.goto(`/admin/support?q=${encodeURIComponent(subject)}`)
    await expect(queueRow(page, subject)).toContainText('Unread message from the requester')
    await queueRow(page, subject).click()
    await expect(selected(page).messages).toContainText('Ref E2E-123')
    await expect(queueRow(page, subject)).not.toContainText('Unread message from the requester')
    await expect.poll(async () => (await staffTicket(ticketId)).unread).toBe(false)
  })

  test('a requester reply reopens a resolved ticket; staff can reopen and then close it for good', async ({ page }) => {
    const student = await signUpViaApi()
    const subject = uniqueName('E2E Admin Close Ticket')
    const ticketId = await fileTicket(student, subject)
    const admin = await adminApi()
    const move = async (status: string, resolutionNotes?: string) => {
      const res = await admin.patch(`admin/support/tickets/${ticketId}`, { data: { status, resolutionNotes } })
      expect(res.status(), await res.text()).toBe(200)
    }
    expect((await admin.post(`admin/support/tickets/${ticketId}/assign`)).status()).toBe(200)
    await move('IN_PROGRESS')
    await move('RESOLVED', 'Sorted out by phone.')

    // The requester writes again: reopened, stale note cleared.
    expect((await student.api.post(`support/conversations/${ticketId}/messages`, { data: { body: 'Still broken' } })).status()).toBe(201)
    expect((await studentConversation(student, ticketId)).ticket).toMatchObject({ status: 'IN_PROGRESS', resolutionNotes: null })

    await move('RESOLVED', 'Fixed for real this time.')
    // Resolved tickets are outside the default "Open" filter.
    await openTicket(page, subject, 'ALL')
    const view = selected(page)
    await expect(view.region.getByText('Resolved', { exact: true })).toBeVisible()

    await view.actions.getByRole('button', { name: 'Reopen' }).click()
    await expect(toast(page, 'Ticket marked in progress')).toBeVisible()
    await expect(view.region.getByText('In progress', { exact: true })).toBeVisible()
    await expect(view.region).not.toContainText('Resolution:')
    await move('RESOLVED', 'Closing after confirmation.')
    await page.reload()
    await expect(selected(page).region.getByText('Resolved', { exact: true })).toBeVisible()

    await view.actions.getByRole('button', { name: 'Close conversation' }).click()
    const dialog = page.getByRole('dialog', { name: 'Close this conversation?' })
    await expect(dialog).toContainText("can't be reopened")
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect((await staffTicket(ticketId)).status).toBe('RESOLVED')

    await view.actions.getByRole('button', { name: 'Close conversation' }).click()
    await dialog.getByRole('button', { name: 'Close conversation' }).click()
    await expect(toast(page, 'Conversation closed')).toBeVisible()
    await expect(view.region.getByText('Closed', { exact: true })).toBeVisible()
    await expect(view.region).toContainText('This conversation is closed.')
    await expect(view.reply).toHaveCount(0)
    await expect(view.actions.getByRole('button')).toHaveCount(0)

    // Closed is final for everyone.
    expect((await student.api.post(`support/conversations/${ticketId}/messages`, { data: { body: 'Hello?' } })).status()).toBe(409)
    expect((await admin.post(`support/conversations/${ticketId}/messages`, { data: { body: 'Hello?' } })).status()).toBe(409)
    expect((await admin.post(`admin/support/tickets/${ticketId}/assign`)).status()).toBe(409)
    expect((await admin.patch(`admin/support/tickets/${ticketId}`, { data: { status: 'IN_PROGRESS' } })).status()).toBe(409)

    // The requester sees it closed, with no composer.
    const context = await page.context().browser()!.newContext({ storageState: await student.api.storageState() })
    const studentPage = await context.newPage()
    await studentPage.goto(`/dashboard/support?ticket=${ticketId}`)
    await expect(main(studentPage)).toContainText('This conversation is closed. Send a new message to start another one.')
    await expect(main(studentPage).getByRole('textbox', { name: 'Type a message…' })).toHaveCount(0)
    await context.close()
    await admin.dispose()
  })

  test('filters narrow the queue and live in the URL', async ({ page }) => {
    const student = await signUpViaApi()
    const subject = uniqueName('E2E Admin Filter Ticket')
    await fileTicket(student, subject)

    await page.goto(`/admin/support?q=${encodeURIComponent(subject)}`)
    await expect(main(page).getByRole('searchbox', { name: 'Search' })).toHaveValue(subject)
    await expect(queueRow(page, subject)).toBeVisible()
    const nothing = main(page).getByText('Nothing matches these filters.')

    const filters: Array<[label: string, option: string, visible: boolean, param: RegExp]> = [
      ['Status', 'New', true, /status=NEW/],
      ['Status', 'Resolved', false, /status=RESOLVED/],
      ['Status', 'All statuses', true, /status=ALL/],
      ['Category', 'Payment', false, /category=PAYMENT/],
      ['Category', 'Registration', true, /category=REGISTRATION/],
      ['Priority', 'Low', false, /priority=LOW/],
      ['Priority', 'High', true, /priority=HIGH/],
      ['Assigned', 'Assigned to me', false, /assignee=me/],
      ['Assigned', 'Unassigned', true, /assignee=unassigned/],
    ]
    for (const [label, option, visible, param] of filters) {
      await main(page).getByLabel(label, { exact: true }).selectOption({ label: option })
      await expect(page).toHaveURL(param)
      if (visible) await expect(queueRow(page, subject)).toBeVisible()
      else await expect(nothing).toBeVisible()
    }
    // Every filter so far is still applied together, and survives a reload.
    await page.reload()
    await expect(main(page).getByLabel('Category', { exact: true })).toHaveValue('REGISTRATION')
    await expect(main(page).getByLabel('Assigned', { exact: true })).toHaveValue('unassigned')
    await expect(queueRow(page, subject)).toBeVisible()

    // Refund exists only as a filter for legacy tickets.
    await expect(main(page).getByLabel('Category', { exact: true }).getByRole('option', { name: 'Refund (legacy)' })).toHaveCount(1)

    await main(page).getByRole('button', { name: 'Clear filters' }).click()
    await expect(page).not.toHaveURL(/[?&](q|status|category|priority|assignee)=/)
    await expect(main(page).getByLabel('Status', { exact: true })).toHaveValue('OPEN')
    await expect(main(page).getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
  })

  test('the queue can be searched by requester email or ticket id', async ({ page }) => {
    const student = await signUpViaApi()
    const subject = uniqueName('E2E Admin Search Ticket')
    const ticketId = await fileTicket(student, subject)
    for (const q of [student.email, ticketId]) {
      await page.goto(`/admin/support?q=${encodeURIComponent(q)}`)
      await expect(queueRow(page, subject)).toHaveCount(1)
    }
    await page.goto(`/admin/support?q=${encodeURIComponent(`no-such-ticket-${Date.now()}`)}`)
    await expect(main(page).getByText('No tickets', { exact: true })).toBeVisible()
  })
})

test.describe('admin support API', () => {
  test('the staff list is paginated and filterable', async () => {
    const student = await signUpViaApi()
    const subject = uniqueName('E2E Admin API Ticket')
    const ticketId = await fileTicket(student, subject)
    const admin = await adminApi()

    const page = await (await admin.get(`admin/support/tickets?q=${encodeURIComponent(subject)}`)).json()
    expect(page.total).toBe(1)
    expect(page.results).toHaveLength(1)
    expect(page.results[0]).toMatchObject({
      id: ticketId,
      subject,
      status: 'NEW',
      assignedTo: null,
      requesterEmail: student.email,
      requesterRole: 'STUDENT',
      unread: true,
    })

    const firstPage = await (await admin.get('admin/support/tickets?limit=2')).json()
    expect(firstPage.results).toHaveLength(2)
    expect(firstPage.total).toBeGreaterThanOrEqual(2)
    for (const query of ['limit=101', 'limit=0', 'status=DONE', 'assignee=someone', 'sort=asc', 'category=COMPLAINTS']) {
      expect((await admin.get(`admin/support/tickets?${query}`)).status(), query).toBe(400)
    }
    const resolvedOnly = await (await admin.get(`admin/support/tickets?status=RESOLVED&q=${encodeURIComponent(subject)}`)).json()
    expect(resolvedOnly.total).toBe(0)
    await admin.dispose()
  })

  test('illegal ticket transitions are refused', async () => {
    const student = await signUpViaApi()
    const ticketId = await fileTicket(student, uniqueName('E2E Admin Skip Ticket'))
    const admin = await adminApi()
    const patch = (data: Record<string, unknown>) => admin.patch(`admin/support/tickets/${ticketId}`, { data })

    // NEW can only be assigned.
    expect((await patch({ status: 'RESOLVED', resolutionNotes: 'skip' })).status()).toBe(409)
    expect((await patch({ status: 'CLOSED' })).status()).toBe(409)
    // ASSIGNED is reached through /assign only, and NEW never again.
    expect((await patch({ status: 'ASSIGNED' })).status()).toBe(400)
    expect((await patch({ status: 'NEW' })).status()).toBe(400)
    expect((await patch({ status: 'IN_PROGRESS', assignedTo: crypto.randomUUID() })).status()).toBe(400)
    expect((await studentConversation(student, ticketId)).ticket.status).toBe('NEW')

    expect((await admin.post(`admin/support/tickets/${ticketId}/assign`)).status()).toBe(200)
    // Assigning again is a no-op.
    const again = await admin.post(`admin/support/tickets/${ticketId}/assign`)
    expect(again.status()).toBe(200)
    expect((await again.json()).status).toBe('ASSIGNED')
    expect((await patch({ status: 'IN_PROGRESS' })).status()).toBe(200)

    // Resolving needs a note.
    for (const data of [{ status: 'RESOLVED' }, { status: 'RESOLVED', resolutionNotes: '   ' }]) {
      const res = await patch(data)
      expect(res.status(), JSON.stringify(data)).toBe(400)
      expect(await res.text()).toContain('resolution note is required')
    }
    expect((await patch({ status: 'RESOLVED', resolutionNotes: 'n'.repeat(2001) })).status()).toBe(400)
    expect((await studentConversation(student, ticketId)).ticket.status).toBe('IN_PROGRESS')

    // A resolved ticket can't be assigned; an unknown one isn't found.
    expect((await patch({ status: 'RESOLVED', resolutionNotes: 'done' })).status()).toBe(200)
    expect((await admin.post(`admin/support/tickets/${ticketId}/assign`)).status()).toBe(409)
    expect((await admin.post(`admin/support/tickets/${crypto.randomUUID()}/assign`)).status()).toBe(404)
    await admin.dispose()
  })

  test('only staff can steer a ticket from a reply', async () => {
    const student = await signUpViaApi()
    const ticketId = await fileTicket(student, uniqueName('E2E Admin Steer Ticket'))
    const steer = await student.api.post(`support/conversations/${ticketId}/messages`, {
      data: { body: 'Mark it done please', nextStatus: 'IN_PROGRESS' },
    })
    expect(steer.status()).toBe(403)
    expect((await studentConversation(student, ticketId)).ticket.status).toBe('NEW')

    const admin = await adminApi()
    const reply = await admin.post(`support/conversations/${ticketId}/messages`, {
      data: { body: 'On it', nextStatus: 'IN_PROGRESS' },
    })
    expect(reply.status()).toBe(201)
    const body = await reply.json()
    expect(body.message).toMatchObject({ body: 'On it', author: 'STAFF' })
    expect(body.ticket).toMatchObject({ id: ticketId, status: 'IN_PROGRESS' })
    expect((await admin.post(`support/conversations/${ticketId}/messages`, { data: { body: 'x', nextStatus: 'RESOLVED' } })).status()).toBe(400)
    await admin.dispose()
  })

  test('another student cannot read someone else\'s ticket', async () => {
    const owner = await signUpViaApi()
    const ticketId = await fileTicket(owner, uniqueName('E2E Admin Private Ticket'))
    const other = await signUpViaApi()
    const response = await other.api.get(`support/conversations/${ticketId}`)
    expect(response.status()).toBe(403)
  })
})
