import { expect, test } from '@playwright/test'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'
import { freshStudentPage, main } from './_helpers'

/** Student support: the ticket form, the inbox, and the floating chat widget. */

test.use({ storageState: { cookies: [], origins: [] } })

function uniqueSubject(label: string) {
  return `E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

test.describe('support tickets', () => {
  test('a student files a ticket and finds it in their support inbox', async ({ browser }) => {
    const { context, page } = await freshStudentPage(browser)
    const crashes = watchForCrashes(page)
    const subject = uniqueSubject('payment question')

    await page.goto('/support/new')
    await expect(pageHeading(page)).toHaveText('Contact Support')
    const submit = main(page).getByRole('button', { name: 'Submit' })
    await expect(submit).toBeDisabled()

    await main(page).getByLabel('Category').selectOption({ label: 'Payment' })
    await main(page).getByLabel('Subject').fill(subject)
    await main(page).getByLabel('Describe the issue').fill('My card was charged but the dashboard still says pending.')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(main(page)).toContainText('Ticket submitted.')
    await main(page).getByRole('button', { name: 'Back to dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await page.goto('/dashboard/support')
    await expect(pageHeading(page)).toHaveText('Support')
    const ticket = main(page).getByRole('button', { name: new RegExp(subject) })
    await expect(ticket).toBeVisible()
    await expect(ticket).toContainText('NEW')

    await ticket.click()
    await expect(main(page).getByRole('button', { name: 'Back to conversations' })).toBeVisible()
    await expect(main(page)).toContainText(subject)
    crashes.assertNone()
    await context.close()
  })

  test('whitespace-only subject or description cannot be submitted', async ({ browser }) => {
    const { context, page, session } = await freshStudentPage(browser)
    await page.goto('/support/new')
    await main(page).getByLabel('Subject').fill('   ')
    await main(page).getByLabel('Describe the issue').fill('Something')
    await expect(main(page).getByRole('button', { name: 'Submit' })).toBeDisabled()

    const res = await session.api.post('support/tickets', {
      data: { category: 'TECHNICAL', subject: '', description: 'x' },
    })
    expect(res.status()).toBe(400)
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

    const read = await session.api.get(`support/conversations/${otherTicket.id}`)
    expect([403, 404]).toContain(read.status())
    const reply = await session.api.post(`support/conversations/${otherTicket.id}/messages`, { data: { body: 'hijack' } })
    expect([403, 404]).toContain(reply.status())
    await other.context.close()
    await context.close()
  })

  test('support pages require sign-in', async ({ page }) => {
    await page.goto('/support/new')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fsupport%2Fnew/)
    await page.goto('/dashboard/support')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard%2Fsupport/)
  })
})

test.describe('support widget', () => {
  test('the open panel is wide enough to use on a desktop screen', async ({ browser }) => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: support sheet is ~12px wide at >=640px — sheet.tsx:54 `sm:max-w-sm` resolves to --spacing-sm (12px), so the chat panel renders off-screen',
    )
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
    // Below the `sm` breakpoint the sheet is full-width, which sidesteps the
    // desktop width bug above so the widget's behaviour can still be covered.
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
    await expect(dialog.getByRole('button', { name: 'Back to conversations' })).toBeVisible()
    await expect(dialog).toContainText(message)

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await context.close()
  })

  test('the widget is not offered to signed-out visitors', async ({ page }) => {
    await page.goto('/muns')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /open support chat/i })).toHaveCount(0)
  })
})
