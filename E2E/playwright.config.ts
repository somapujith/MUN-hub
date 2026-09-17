import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { API_PORT, API_URL, DATABASE_URL, WEB_PORT, WEB_URL, assertLocalDatabase } from './env'
import { STORAGE_STATE } from './paths'

// Fail fast, before Playwright spawns anything, if the target DB isn't local.
assertLocalDatabase()

const ROOT = path.resolve(__dirname, '..')

// E2E_BROWSER_CHANNEL=chromium uses Playwright's bundled browser (needs
// `npx playwright install chromium`); the default drives the locally
// installed Google Chrome, which works where the bundled download is blocked.
const channel = process.env.E2E_BROWSER_CHANNEL === 'chromium' ? undefined : 'chrome'

export default defineConfig({
  testDir: '.',
  outputDir: process.env.E2E_OUTPUT_DIR ?? './test-results',
  globalSetup: './global-setup.ts',
  // Tests share one seeded database; per-test data uses unique emails, but
  // capacity/registration specs mutate shared MUNs, so keep it serial and
  // deterministic rather than chasing cross-test interference.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: process.env.E2E_REPORT_DIR ?? './playwright-report', open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Opt-in: recording needs the ffmpeg download (`npx playwright install
    // ffmpeg`), which isn't available everywhere. Traces already capture a
    // full step-by-step replay of any failure.
    video: process.env.E2E_VIDEO ? 'retain-on-failure' : 'off',
    ...devices['Desktop Chrome'],
  },

  projects: [
    // Signs in once per role and saves the session, so the login rate limit
    // (5/min per IP+email, server/middleware/rate-limit.ts) is hit ~3 times
    // total instead of once per test.
    { name: 'setup', testMatch: /setup\/.*\.setup\.ts/ },

    { name: 'public', testMatch: /specs\/public\/.*\.spec\.ts/ },
    { name: 'auth', testMatch: /specs\/auth\/.*\.spec\.ts/ },
    {
      name: 'student',
      testMatch: /specs\/student\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: STORAGE_STATE.student },
    },
    {
      name: 'organizer',
      testMatch: /specs\/organizer\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: STORAGE_STATE.organizer },
    },
    {
      name: 'admin',
      testMatch: /specs\/admin\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: STORAGE_STATE.admin },
    },
    // Cross-role authorization checks — each test picks its own identity.
    { name: 'security', testMatch: /specs\/security\/.*\.spec\.ts/, dependencies: ['setup'] },
    {
      name: 'mobile',
      testMatch: /specs\/mobile\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], channel },
    },
  ],

  // Always spawned fresh on dedicated ports — never reuses a running dev
  // server, whose database we couldn't verify. See env.ts.
  webServer: [
    {
      name: 'api',
      // Migrate + seed (both idempotent) BEFORE the API boots: Playwright
      // starts webServers before globalSetup, and the readiness probe below
      // queries the database, so a fresh DB must be ready first. Runs from
      // the repo root because lib/db/migrate.ts resolves ./drizzle from cwd.
      cwd: ROOT,
      // E2E_SKIP_DB_PREPARE=1 skips migrate/seed/reset — only for running
      // several suites side by side against a database that was already
      // prepared once (a reset would wipe the other runs' registrations).
      command: `${
        process.env.E2E_SKIP_DB_PREPARE
          ? ''
          : 'npx tsx lib/db/migrate.ts && npx tsx lib/db/seed.ts && npx tsx E2E/prepare-db.ts && '
      }cd server && npx tsx --env-file=.env src/index.ts`,
      url: `${API_URL}/muns`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        // Existing env wins over --env-file, so these override server/.env.
        DATABASE_URL,
        PORT: String(API_PORT),
        NODE_ENV: 'development',
        CORS_ORIGINS: WEB_URL,
        COOKIE_DOMAIN: '',
        // Every request in a local run comes from 127.0.0.1, so the default
        // 300/min per-IP cap would throttle the suite. Only the generic cap
        // is raised; the login and organizer-code limits stay as in prod.
        RATE_LIMIT_GLOBAL_PER_MINUTE: '100000',
        TRUST_PROXY_HEADERS: '',
        // Local-only switches the suite depends on: the mock checkout (off in
        // production until the real gateway lands) and trusting the
        // localhost web origin for CORS/CSRF.
        MOCK_PAYMENTS_ENABLED: 'true',
        ALLOW_LOCALHOST_ORIGINS: 'true',
      },
    },
    {
      name: 'web',
      cwd: path.join(ROOT, 'web'),
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { VITE_API_URL: API_URL },
    },
  ],
})
