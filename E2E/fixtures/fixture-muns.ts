/**
 * The dedicated MUNs the E2E suite creates and resets on every run
 * (E2E/prepare-db.ts). Specs reference these by slug/name — never by id,
 * which changes if the local database is recreated.
 *
 * Plain data only (no Playwright/DB imports), so both the Node-side
 * preparation script and the specs can import it.
 */
export const FIXTURE_MUNS = {
  ownerEmail: 'organizer@munhub.test',

  /** REGISTRATION_OPEN, window open. All registrations wiped each run. */
  open: {
    slug: 'e2e-open-mun',
    name: 'E2E Open MUN',
    committees: [
      // Portfolios seat many delegates here, so specs can reuse them across runs
      // that skip the registration wipe (single-seat portfolios are unit-tested).
      { name: 'E2E General Assembly', capacity: 100, portfolioSeats: 100, portfolios: ['India', 'Brazil', 'Japan'] },
      // Deliberately tiny. Reserved for specs/security/registration-eligibility.spec.ts's
      // committee-capacity test — other specs must not register delegates into it.
      { name: 'E2E Security Council', capacity: 2, portfolios: ['France', 'Germany'] },
    ],
    products: [
      { name: 'E2E Delegate Pass', price: 1499, capacity: 500, status: 'active', displayOrder: 0 },
      // Deliberately tiny, for sold-out / oversell tests.
      { name: 'E2E Limited Pass', price: 999, capacity: 2, status: 'active', displayOrder: 1 },
      // Inactive: must never be shown publicly or be purchasable.
      { name: 'E2E Retired Pass', price: 500, capacity: 50, status: 'inactive', displayOrder: 2 },
    ],
  },

  /** ONBOARDING — the only MUN organizer specs may edit. Created entities accumulate (unique names). */
  sandbox: {
    slug: 'e2e-sandbox-mun',
    name: 'E2E Sandbox MUN',
    committees: [{ name: 'E2E Sandbox Committee', capacity: 40, portfolios: ['Canada'] }],
  },

  /** PUBLISHED but NOT open for registration, with an active pass. */
  closed: {
    slug: 'e2e-closed-mun',
    name: 'E2E Closed MUN',
    products: [{ name: 'E2E Closed Delegate Pass', price: 1200, capacity: 100, status: 'active', displayOrder: 0 }],
  },
} as const

export const OPEN = FIXTURE_MUNS.open
export const SANDBOX = FIXTURE_MUNS.sandbox
export const CLOSED = FIXTURE_MUNS.closed
