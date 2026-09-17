import { expect, test, type Page } from '@playwright/test'
import { watchForCrashes } from '../../fixtures/ui'
import { createApplication, heading, main } from './_helpers'

/** Admin MVP: the Operations overview — queue depth at a glance (PRD admin dashboard). */

const TILES = [
  { label: 'Pending Applications', href: '/admin/review', heading: 'Applications' },
  { label: 'Pending Module Reviews', href: '/admin/verification', heading: 'Verification' },
  { label: 'Open Support Tickets', href: '/admin/support', heading: 'Support' },
  { label: 'Payment Exceptions', href: '/admin/payments', heading: 'Payments' },
  { label: 'Go-live queue', href: '/admin/go-live-queue', heading: 'Go-live queue' },
] as const

function tile(page: Page, label: string) {
  return main(page).getByRole('link', { name: new RegExp(`^${label}\\s*\\d+$`) })
}

async function tileCount(page: Page, label: string): Promise<number> {
  const name = (await tile(page, label).textContent()) ?? ''
  return Number(name.replace(label, '').trim())
}

test.describe('admin overview', () => {
  test('shows all five queue tiles with numeric counts', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await page.goto('/admin')
    await expect(heading(page, 'Overview')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const { label, href } of TILES) {
      await expect(tile(page, label)).toBeVisible()
      await expect(tile(page, label)).toHaveAttribute('href', href)
      expect(Number.isInteger(await tileCount(page, label))).toBe(true)
    }
    crashes.assertNone()
  })

  for (const { label, href, heading: target } of TILES) {
    test(`the "${label}" tile opens its queue`, async ({ page }) => {
      await page.goto('/admin')
      await tile(page, label).click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(heading(page, target)).toBeVisible()
    })
  }

  test('the pending-applications count goes up when an organizer applies', async ({ page }) => {
    await page.goto('/admin')
    await expect(tile(page, 'Pending Applications')).toBeVisible()
    const before = await tileCount(page, 'Pending Applications')

    await createApplication('E2E Admin Overview')

    await page.reload()
    await expect(tile(page, 'Pending Applications')).toBeVisible()
    expect(await tileCount(page, 'Pending Applications')).toBeGreaterThanOrEqual(before + 1)
  })
})
