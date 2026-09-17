# MUN Hub end-to-end tests

Playwright tests that drive the real Vite SPA (`web/`) against the real Hono API (`server/`) and a real local Postgres. They cover every role (visitor, delegate, organizer, admin) across the whole product: marketplace, sign-up and sign-in, the participant profile, the registration and payment funnel, the organizer workspace and onboarding, the admin console, cross-cutting security, and mobile.

## Running

Prerequisites: Docker Postgres running (`npm run db:up`), dependencies installed in the root, `web/` and `server/`, and Google Chrome installed.

```bash
npm run test:e2e                                   # whole suite
npm run test:e2e -- --project=student              # one area
npm run test:e2e -- E2E/specs/auth/login.spec.ts   # one file
npm run test:e2e:ui                                # interactive runner
npm run test:e2e:report                            # open the last HTML report
```

Each run:

1. Refuses to start unless `DATABASE_URL` points at a local database (`env.ts`). There is no override. Once, a test run wrote hundreds of junk rows into the shared Neon database.
2. Starts its own API (port 3101) and web app (port 5175). It never reuses a dev server, because it can't check which database that server is using.
3. Migrates, seeds and resets the fixture MUNs (`prepare-db.ts`) before the API boots.
4. Signs in once per seeded role through the real login form (`setup/auth.setup.ts`) and reuses those sessions. Logins are rate-limited to 5 per minute per email.

## Organizer sign-in codes

Organizers have no password. They sign in with a 6-digit code sent by email (`lib/actions/organizer-otp.ts`), and the local API only prints that email to its console. Tests therefore plant a code they know:

- `seedOrganizerLoginCode(email)` in `fixtures/api.ts` writes a fresh, hashed, unconsumed row to the local `email_login_codes` table. The code is `TEST_LOGIN_CODE` (`123456`). The row is backdated so it doesn't trigger the resend cooldown.
- `signUpOrganizerViaApi()` and `signInOrganizerViaApi(email)` use it to return a signed-in organizer session without the per-IP code-request limit.
- In a UI test, click "Send OTP" first and plant the code afterwards (`enterPlantedCode` in `specs/auth/_helpers.ts`), because requesting a code consumes older ones.

The seeded demo organizers still have legacy password hashes, which is why the per-role setup can sign them in through `/login`.

## Layout

| Path | Contents |
|---|---|
| `playwright.config.ts` | Projects, servers, reporters |
| `env.ts`, `paths.ts` | Ports, database guard, saved-session paths |
| `prepare-db.ts` | Creates and resets the fixture MUNs below |
| `fixtures/` | Seeded accounts, fixture MUN definitions, API helpers (`signUpViaApi`, `signInViaApi`, …), UI helpers |
| `setup/` | Per-role sign-in |
| `specs/public/` | Home, marketplace, MUN detail, navigation (signed out) |
| `specs/auth/` | Login doors, delegate signup, passwordless organizer signup and sign-in, password reset, redirect preservation |
| `specs/student/` | Registration funnel, dashboard, profile, support, role boundaries, privacy |
| `specs/organizer/` | Onboarding journey, workspace, every module, registrations, go-live |
| `specs/admin/` | Overview, applications (Gate 1), verification and go-live (Gate 2), organizers, registrations, payments, support, audit |
| `specs/security/` | CSRF, CORS, cookies, rate limits, mass assignment, tenant boundaries, registration eligibility |
| `specs/mobile/` | Phone viewport: layout, menu, tap targets, the funnel |

## Test data

`prepare-db.ts` owns three MUNs belonging to `organizer@munhub.test` and resets them on every run. Specs refer to them by slug, never by id (`fixtures/fixture-muns.ts`):

- **`e2e-open-mun`**: open for registration. Its registrations are wiped at the start of every run. The capacity-2 "E2E Security Council" is reserved for the committee-capacity security test, and the capacity-2 "E2E Limited Pass" exists for the sold-out tests.
- **`e2e-sandbox-mun`**: in onboarding. This is the **only** MUN organizer specs may edit. Editing a published MUN sends it back to verification, which would close registration for the other specs.
- **`e2e-closed-mun`**: published but not open for registration.

No seeded MUN is open for registration, which is why the fixtures exist.

Most tests create their own fresh accounts through the real signup endpoints and give them unique emails, so tests don't collide and don't hit the login rate limit. The local database also holds unrelated rows left by unit tests, so admin specs find their own items by unique name and never assert on queue totals.

## Known bugs

A test that documents a confirmed bug asserts the correct behavior and is marked `test.fail(...)` with a `BUG:` description, so the suite stays green. When the bug is fixed, that test starts "unexpectedly passing" and fails the run. Remove the marker at that point. To see the real failures:

```bash
E2E_SHOW_KNOWN_BUGS=1 npm run test:e2e -- --project=security
```

Tests for features the PRDs require but the app doesn't have yet are marked `test.fixme(...)`, which is a different thing from a bug.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `E2E_DATABASE_URL` | local docker Postgres | Must be a local database |
| `E2E_API_PORT` / `E2E_WEB_PORT` | `3101` / `5175` | Server ports |
| `E2E_BROWSER_CHANNEL` | `chrome` | Set to `chromium` to use Playwright's bundled browser |
| `E2E_VIDEO` | unset | Record videos of failures (needs `npx playwright install ffmpeg`) |
| `E2E_SHOW_KNOWN_BUGS` | unset | Turn off `test.fail` markers |
| `E2E_SKIP_DB_PREPARE` | unset | Skip migrate/seed/reset. Only for running several suites side by side on different ports against an already-prepared database. After pulling new migrations, first run `DATABASE_URL=postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub npx tsx lib/db/migrate.ts`; otherwise the API fails on missing columns |
| `E2E_AUTH_DIR`, `E2E_OUTPUT_DIR`, `E2E_REPORT_DIR` | inside `E2E/` | Keep parallel runs from overwriting each other. Paths are relative to `E2E/`, so use a bare name such as `test-results-2` |

## Rate limits

The API rate-limits by client IP, and a local test run makes every request from `127.0.0.1`. The server takes the IP from the socket (or `CF-Connecting-IP` on Workers) and ignores `X-Forwarded-For` unless `TRUST_PROXY_HEADERS=true`. A test therefore can't pose as another client by sending that header; `specs/security/api-security.spec.ts` checks this.

To keep the suite from throttling itself, `playwright.config.ts` starts the API with `RATE_LIMIT_GLOBAL_PER_MINUTE=100000`. That raises only the generic per-IP cap (300/min by default). The dedicated limits stay at their production values: sign-in is 5/min per IP+email, organizer code requests are 3/min per IP+email plus 30/min per IP, and organizer code verification is 10/min per IP+email. Tests should use a fresh email per attempt rather than work around these limits. If a run starts getting `429`s from one of them, spread the requests over more emails; don't reintroduce header tricks.

## API server settings

Besides the database, ports and rate limit above, `playwright.config.ts` starts the API with `MOCK_PAYMENTS_ENABLED=true` (the mock checkout the payment specs drive, off in production) and `ALLOW_LOCALHOST_ORIGINS=true` (so CORS/CSRF accept the local web origin).

## Writing tests

- Use role and label selectors scoped to `main`, `banner` or `dialog`. No CSS classes and no `waitForTimeout`.
- The header's "Sign in" and "Create account" are links styled as buttons, so their role is `button`.
- Create your own data with unique names. Never change seeded or fixture MUNs outside what's described above.
- Wrap flows in `watchForCrashes(page)` so uncaught React errors fail the test.
