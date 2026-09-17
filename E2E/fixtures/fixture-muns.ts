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

  /**
   * PUBLISHED with a MUNHub-verified payment account and an open window, so
   * registration can be opened. Reserved for specs/organizer/lifecycle.spec.ts,
   * which walks it through open → close → cancel; reset to PUBLISHED (and its
   * registrations wiped) every run.
   */
  lifecycle: {
    slug: 'e2e-lifecycle-mun',
    name: 'E2E Lifecycle MUN',
    products: [{ name: 'E2E Lifecycle Pass', price: 800, capacity: 50, status: 'active', displayOrder: 0 }],
  },

  /**
   * ONBOARDING with all 15 go-live modules filled in (lib/db/seed-go-live-modules.ts),
   * so it can pass automated validation and go through Gate 2 review and publish.
   * Deleted and recreated every run (new id each time). Reserved for
   * specs/admin/content-review.spec.ts.
   */
  review: {
    slug: 'e2e-review-mun',
    name: 'E2E Review MUN',
    committees: [{ name: 'E2E Review Committee', capacity: 60, portfolios: ['Kenya', 'Chile'] }],
    products: [{ name: 'E2E Review Pass', price: 1100, capacity: 120, status: 'active', displayOrder: 0 }],
  },

  /** Same as review, for the organizer's submission UI (specs/organizer/submission.spec.ts). */
  confirm: {
    slug: 'e2e-confirm-mun',
    name: 'E2E Confirm MUN',
    committees: [{ name: 'E2E Confirm Committee', capacity: 60, portfolios: ['Ghana'] }],
    products: [{ name: 'E2E Confirm Pass', price: 950, capacity: 90, status: 'active', displayOrder: 0 }],
  },

  /** Same as review, for the admin console UI specs (specs/admin/muns-console.spec.ts). Reset with recreateReadyMun(). */
  adminConsole: {
    slug: 'e2e-admin-console-mun',
    name: 'E2E Admin Console MUN',
    committees: [{ name: 'E2E Console Committee', capacity: 60, portfolios: ['Norway'] }],
    products: [{ name: 'E2E Console Pass', price: 700, capacity: 60, status: 'active', displayOrder: 0 }],
  },

  /** Same as review, for the suspend/reinstate path (a reinstated MUN goes back to verification). */
  suspend: {
    slug: 'e2e-suspend-mun',
    name: 'E2E Suspend MUN',
    committees: [{ name: 'E2E Suspend Committee', capacity: 60, portfolios: ['Peru'] }],
    products: [{ name: 'E2E Suspend Pass', price: 900, capacity: 80, status: 'active', displayOrder: 0 }],
  },

  /**
   * Conference-day operations (check-in, passes, delegate messages, attendance,
   * results). Deleted and recreated (fixtures/ops-fixture-db.ts#recreateOpsMun)
   * by the specs that use it, REGISTRATION_OPEN with the conference starting in
   * two hours so door check-in is already open; conference-ops.spec then moves
   * it to CONFERENCE_ACTIVE and through results review. Recreating also clears
   * its hourly delegate-message quota. Reserved for
   * specs/organizer/conference-ops.spec.ts and operations.spec.ts's
   * Communications › sending tests.
   */
  ops: {
    slug: 'e2e-ops-mun',
    name: 'E2E Ops MUN',
    committees: [
      { name: 'E2E Ops Committee', capacity: 100, portfolioSeats: 100, portfolios: ['Italy', 'Spain'] },
      { name: 'E2E Ops Press Room', capacity: 100, portfolioSeats: 100, portfolios: ['Reuters'] },
    ],
    products: [
      { name: 'E2E Ops Delegate Pass', price: 1200, capacity: 100, status: 'active', displayOrder: 0 },
      { name: 'E2E Ops Observer Pass', price: 600, capacity: 100, status: 'active', displayOrder: 1 },
    ],
  },
} as const

export const OPEN = FIXTURE_MUNS.open
export const REVIEW = FIXTURE_MUNS.review
export const SUSPEND = FIXTURE_MUNS.suspend
export const CONFIRM = FIXTURE_MUNS.confirm
export const ADMIN_CONSOLE = FIXTURE_MUNS.adminConsole
export const LIFECYCLE = FIXTURE_MUNS.lifecycle
export const SANDBOX = FIXTURE_MUNS.sandbox
export const CLOSED = FIXTURE_MUNS.closed
export const OPS = FIXTURE_MUNS.ops
