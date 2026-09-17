/**
 * Accounts and data created by `npm run db:seed` (lib/db/seed.ts), which the
 * E2E API server runs on every start. All seeded accounts share one demo
 * password.
 */

export const DEMO_PASSWORD = 'munhub-demo'

export type SeededRole = 'student' | 'organizer' | 'admin'

export const ACCOUNTS: Record<SeededRole, { email: string; role: string; home: RegExp }> = {
  student: { email: 'student@munhub.test', role: 'STUDENT', home: /\/dashboard$/ },
  // Owns the seeded Oxford MUN 2027.
  organizer: { email: 'organizer@munhub.test', role: 'ORGANIZER', home: /\/organizer\/dashboard/ },
  admin: { email: 'admin@munhub.test', role: 'ADMIN', home: /\/admin/ },
}

/** A second organizer, who does NOT own Oxford — used for cross-tenant authorization checks. */
export const OTHER_ORGANIZER_EMAIL = 'organizer-vit@munhub.test'

export const MUNS = {
  /** Seeded with status REGISTRATION_OPEN, two active passes (Delegate ₹2500, Press ₹1500), and committees UNSC/UNHRC. */
  open: { slug: 'oxford-mun-2027', name: 'Oxford MUN 2027' },
  /** Seeded as PUBLISHED but not open for registration. */
  published: { slug: 'vit-mun-2027', name: 'VIT MUN 2027' },
  /** One of the real Hyderabad conferences in the seed. */
  hyderabad: { slug: 'bitsmun-hyderabad-25', name: "BITSMUN Hyderabad '25" },
} as const

export const NONEXISTENT_MUN_SLUG = 'this-mun-does-not-exist-e2e'
