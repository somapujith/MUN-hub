import { expect, type Page } from '@playwright/test'
import { DEMO_PASSWORD } from './accounts'

/**
 * Shared UI interactions, written against accessible roles/labels rather
 * than CSS classes so they survive restyling.
 */

export async function fillLoginForm(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  // Scoped to <main>: the header also renders a "Sign in" button-link.
  await page.getByRole('main').getByRole('button', { name: /^sign in$/i }).click()
}

/** Signs in through a login door (/login, /organizer/login, /admin/login). */
export async function signInThroughUi(page: Page, email: string, password = DEMO_PASSWORD, door = '/login') {
  await page.goto(door)
  await fillLoginForm(page, email, password)
}

/** The signed-in account menu (web/src/components/layout/site-header-user-menu.tsx). */
export function accountMenuButton(page: Page) {
  return page.getByRole('button', { name: /account menu/i })
}

export async function openAccountMenu(page: Page): Promise<void> {
  await accountMenuButton(page).click()
}

export async function signOutThroughUi(page: Page): Promise<void> {
  await openAccountMenu(page)
  await page.getByRole('menuitem', { name: /sign out/i }).click()
}

/**
 * Signed-out header state: "Sign in" + "Create account" present, no account
 * menu. Both are links styled as buttons (`<a role="button">`), so their
 * accessible role is `button`.
 */
export async function expectSignedOutHeader(page: Page): Promise<void> {
  const header = page.getByRole('banner')
  await expect(header.getByRole('button', { name: /^sign in$/i })).toBeVisible()
  await expect(header.getByRole('button', { name: /^create account$/i })).toBeVisible()
  await expect(accountMenuButton(page)).toHaveCount(0)
}

/** The header's "Sign in" / "Create account" controls. */
export function headerButton(page: Page, name: RegExp) {
  return page.getByRole('banner').getByRole('button', { name })
}

export async function expectSignedInHeader(page: Page, role?: string): Promise<void> {
  const button = accountMenuButton(page)
  await expect(button).toBeVisible()
  if (role) await expect(button).toHaveAccessibleName(new RegExp(role, 'i'))
}

/** The main page heading — every page in the app renders exactly one h1. */
export function pageHeading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

/**
 * Fails the test on uncaught page errors (React crashes, bad hydration,
 * undefined access). Console `error`s are collected too, but only page
 * errors fail — expected 401s from signed-out probes log as console errors
 * and aren't bugs.
 */
export function watchForCrashes(page: Page): { assertNone: () => void } {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return {
    assertNone: () => expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]),
  }
}
