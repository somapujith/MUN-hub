import { expect, test as setup } from '@playwright/test'
import { STORAGE_STATE } from '../paths'
import { ACCOUNTS, type SeededRole } from '../fixtures/accounts'
import { signInThroughUi } from '../fixtures/ui'

/**
 * Signs each seeded role in once, through the real login form, and saves
 * the resulting session so role-scoped specs start already authenticated.
 * Doing this through the UI (not the API) means the login flow itself is
 * exercised on every run, even if no auth spec is selected.
 */
const roles: SeededRole[] = ['student', 'organizer', 'admin']

for (const role of roles) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const account = ACCOUNTS[role]
    await signInThroughUi(page, account.email)
    await expect(page).toHaveURL(account.home)
    await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible()
    await page.context().storageState({ path: STORAGE_STATE[role] })
  })
}
