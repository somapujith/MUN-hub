import { expect, test, type Page } from '@playwright/test'
import { signUpViaApi, type ApiSession } from '../../fixtures/api'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, heading, main, uniqueName } from './_helpers'

/** Admin support queue, driven by tickets a fresh student files. */

async function fileTicket(student: ApiSession, subject: string) {
  const response = await student.api.post('support/tickets', {
    data: {
      category: 'REGISTRATION',
      priority: 'HIGH',
      subject,
      description: 'I paid but my dashboard still shows payment pending.',
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

interface Conversation {
  ticket: { status: string; resolutionNotes: string | null }
  messages: Array<{ body: string; senderId: string }>
}

async function studentConversation(student: ApiSession, ticketId: string): Promise<Conversation> {
  const response = await student.api.get(`support/conversations/${ticketId}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as Conversation
}

/** The one ticket card whose subject is `subject`. */
function ticketCard(page: Page, subject: string) {
  // Nearest ancestor that also holds the card's conversation toggle.
  return main(page)
    .getByText(subject, { exact: true })
    .locator('xpath=ancestor::div[.//button[contains(., "conversation")]][1]')
}

test.describe('admin support queue', () => {
  test('a student\'s ticket is worked from NEW to RESOLVED, and the student sees the reply', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const studentName = uniqueName('E2E Admin Requester')
    const student = await signUpViaApi({ name: studentName })
    const subject = uniqueName('E2E Admin Ticket')
    const ticketId = await fileTicket(student, subject)

    await page.goto('/admin/support')
    await expect(heading(page, 'Support')).toBeVisible()
    const card = ticketCard(page, subject)
    await expect(card).toBeVisible()
    await expect(card).toContainText(`Filed by ${studentName}`)
    await expect(card).toContainText('STUDENT')
    await expect(card).toContainText('REGISTRATION')
    await expect(card).toContainText('HIGH')
    await expect(card).toContainText('NEW')
    await expect(card.getByRole('button', { name: 'Resolve' })).toHaveCount(0)

    await card.getByRole('button', { name: 'Assign to me' }).click()
    await expect(page.getByText('Ticket assigned to you')).toBeVisible()
    await expect(card).toContainText('ASSIGNED')
    await expect(card.getByRole('button', { name: 'Assign to me' })).toHaveCount(0)

    await card.getByRole('button', { name: 'In progress' }).click()
    await expect(page.getByText('Ticket marked in progress')).toBeVisible()
    await expect(card).toContainText('IN_PROGRESS')

    // Reply in the conversation thread.
    await card.getByRole('button', { name: 'View conversation' }).click()
    await expect(card.getByText('No messages yet.')).toBeVisible()
    const reply = `Thanks — we're checking with the payment provider (${Date.now()}).`
    const send = card.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await card.getByPlaceholder('Reply to this conversation…').fill(reply)
    await send.click()
    await expect(card.getByText(reply)).toBeVisible()
    await expect(card.getByText('Staff', { exact: true })).toBeVisible()
    await expect(card.getByPlaceholder('Reply to this conversation…')).toHaveValue('')

    await expect.poll(async () => (await studentConversation(student, ticketId)).messages.map((m) => m.body)).toContain(reply)

    // The student answers; the admin sees it in the thread.
    const followUp = `Order ref E2E-${Date.now()}`
    expect((await student.api.post(`support/conversations/${ticketId}/messages`, { data: { body: followUp } })).status()).toBe(201)
    await expect(card.getByText(followUp)).toBeVisible({ timeout: 15_000 })

    // Resolve with notes.
    await card.getByRole('button', { name: 'Resolve' }).click()
    const dialog = page.getByRole('dialog', { name: 'Resolve this ticket?' })
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Confirm resolve' })
    await expect(confirm).toBeDisabled()
    const notes = 'Payment webhook replayed; registration confirmed.'
    await dialog.getByRole('textbox', { name: 'Resolution notes' }).fill(notes)
    await confirm.click()
    await expect(page.getByText('Ticket resolved')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(card).toContainText('RESOLVED')
    await expect(card).toContainText(`Resolution: ${notes}`)

    const conversation = await studentConversation(student, ticketId)
    expect(conversation.ticket.status).toBe('RESOLVED')
    expect(conversation.ticket.resolutionNotes).toBe(notes)
    crashes.assertNone()
  })

  test('the status filter narrows the queue', async ({ page }) => {
    const student = await signUpViaApi()
    const subject = uniqueName('E2E Admin Filter Ticket')
    await fileTicket(student, subject)

    await page.goto('/admin/support')
    const filter = main(page).getByRole('combobox', { name: 'Status' })
    await expect(ticketCard(page, subject)).toBeVisible()

    await filter.selectOption({ label: 'New' })
    await expect(ticketCard(page, subject)).toBeVisible()
    await filter.selectOption({ label: 'Resolved' })
    await expect(main(page).getByText(subject, { exact: true })).toHaveCount(0)
    await filter.selectOption({ label: 'All statuses' })
    await expect(ticketCard(page, subject)).toBeVisible()
  })

  test('a ticket cannot skip straight from NEW to RESOLVED', async () => {
    const student = await signUpViaApi()
    const ticketId = await fileTicket(student, uniqueName('E2E Admin Skip Ticket'))
    const admin = await adminApi()
    const response = await admin.patch(`admin/support/tickets/${ticketId}`, {
      data: { status: 'RESOLVED', resolutionNotes: 'skip' },
    })
    expect(response.ok()).toBe(false)
    expect((await studentConversation(student, ticketId)).ticket.status).toBe('NEW')
  })

  test('an illegal ticket transition is reported as a client error', async () => {
    const student = await signUpViaApi()
    const ticketId = await fileTicket(student, uniqueName('E2E Admin Skip Ticket'))
    const admin = await adminApi()
    const response = await admin.patch(`admin/support/tickets/${ticketId}`, { data: { status: 'CLOSED' } })
    expect(response.status()).toBe(409)
  })

  test('another student cannot read someone else\'s ticket', async () => {
    const owner = await signUpViaApi()
    const ticketId = await fileTicket(owner, uniqueName('E2E Admin Private Ticket'))
    const other = await signUpViaApi()
    const response = await other.api.get(`support/conversations/${ticketId}`)
    expect(response.status()).toBe(403)
  })
})
