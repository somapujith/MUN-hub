# lane sec-auth — authentication hardening

Lead: mun-hub-62. Branch `worktree-wf_a8625366-3be-2`, fast-forwarded to `main@73bcdf4` before starting, because the worktree was created from an older commit that didn't have the run docs or migration 0031.

## What changed

### 1. Rate limiting that works on Workers (`6af4259`)
- Each limit is a named `LimiterSpec` in `server/middleware/rate-limit.ts#LIMITERS`, backed by a **Workers Rate Limiting binding** (`server/wrangler.jsonc` → `"ratelimits"`, `{ name, namespace_id, simple: { limit, period } }`, called as `env.<NAME>.limit({ key })`). I checked the config shape against the Cloudflare docs; `period` must be 10 or 60. `wrangler deploy --dry-run` lists all 14 bindings. A test checks that wrangler.jsonc matches `LIMITERS` (names, limits, periods, unique namespace ids).
- If a binding is missing (Node dev, tests) or its call throws, the same limit runs through the existing in-memory counter. That counter now also sweeps expired buckets.
- The global per-IP cap (300/min) now applies to **every** `/api/v1` request. A route rule adds limits on top; it no longer replaces the global cap.
- Rules: login 20/min per IP **and** 5/min per account (email); signup 10/min per IP; reset request 10/min per IP **and** 3/min per email; reset confirm 10/min per IP; change password 5/min per user. The organizer code, code verify, registrations, availability and MUN-list limits are unchanged. Keys still use `CF-Connecting-IP` (`getClientIp`).
- The per-account reset throttle lives in `lib/actions/password-reset.ts`: at most 1 link a minute and 3 an hour per account. It is silent (still 204), so it doesn't reveal which emails have accounts. Workers bindings can't do hourly windows.
- `RATE_LIMIT_IP_MULTIPLIER` multiplies IP-keyed limits in the **in-memory fallback only**. `RATE_LIMIT_GLOBAL_PER_MINUTE` still replaces the global fallback cap. Neither affects the bindings.

### 2. Tokens at rest and session lifetime (`e5286ff`, `ac30672`)
- Session and reset tokens are stored as SHA-256 hex (`lib/auth/opaque-token.ts`), and lookups hash the presented token. No schema change.
- **Deploy effect:** every existing session stops matching, so every user must sign in again once. Old rows stay harmless (a stored raw value hashes to nothing) and age out at their old `expiresAt` (≤30 days). Outstanding reset links (1 h TTL) also stop working.
- A reset token is consumed atomically: a conditional `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING` in the same transaction as the password update and session wipe. A successful reset also uses up the account's other outstanding links. A cheap SELECT runs first, so a bogus token never costs a scrypt hash.
- `insertPasswordResetToken(executor, userId, expiresAt)` is now the only supported way to mint a reset or set-password link (see follow-up 1).
- Sliding sessions, no schema change: `expiresAt` = min(now + 7 days, `createdAt` + 30 days). It is extended at most once per hour, and lookups also reject anything older than 30 days. The cookie `Max-Age` is the 30-day cap; the server-side deadline decides whether the session is still valid.
- `changePassword(current, next, session, currentSessionToken)` deletes all of the user's **other** sessions in the same transaction. The route passes the cookie token.

### 3. Password hashing (`e5286ff`)
- New format: `scrypt$N$r$p$saltHex$keyHex` with N=2^15, r=8, p=1 (`maxmem` raised because Node's 32 MiB default is exactly at the limit).
- **Cost reasoning:** measured locally (Node 24) 2^14 ≈ 35 ms, 2^15 ≈ 65 ms, 2^16 ≈ 130 ms. I also ran the real `lib/auth/password.ts` inside local **workerd** (`wrangler dev`): 2^15 hashes and verifies in ≈ 60–70 ms, and legacy hashes still verify. 2^16 needs 64 MiB per hash inside a 128 MiB isolate that concurrent requests share, so I chose 2^15.
- Legacy `salt:hash` values still verify. A successful sign-in re-hashes them, using a conditional update so a concurrent password change isn't overwritten. The rehash is best-effort.
- Sign-in always runs exactly one scrypt verification, against `DUMMY_PASSWORD_HASH` when the email is unknown or the account has no password. Until an account's hash is upgraded, a legacy account still verifies at 2^14, which is a small, temporary timing difference.
- Organizer OTP codes use the same hasher, so they are now stored in the new format too. Old code rows still verify.

### 4. Guardian consent (`e5286ff`, `99ebc9e`)
- `signUp` requires `acceptedGuardianAcknowledgement === true` when the date of birth is under 18, by calendar birthday in UTC (`isUnderAdultAge`). Otherwise it throws `GUARDIAN_CONSENT_REQUIRED` ("For users under 18, parent or guardian consent is required"). Because the message ends in "is required", the existing rule in `server/middleware/error.ts` maps it to 400. I did not edit `error.ts`.
- `signup-page.tsx`: for a minor the checkbox is `required`, marked `*`, and has a hint. Submitting without it shows a clear message. The acknowledgement is sent only while the date of birth is still a minor's. The page uses the same UTC birthday rule as the server; the old 365.25-day approximation is gone.

### 5. Cookie Secure flag (`e5286ff`, `6af4259`)
- `sessionCookieSecure(url)`: `COOKIE_SECURE=true|false` decides. When it is unset, the cookie is Secure unless the request is plain http to localhost, 127.0.0.1 or [::1], so local dev, the E2E suite and `app.request` keep working. It no longer depends on `NODE_ENV`. Production sets `COOKIE_SECURE: "true"` in `server/wrangler.jsonc`. Sign-out's `deleteCookie` uses the same flag.

### 6. Turnstile (`e5286ff`, `99ebc9e`)
- `server/lib/turnstile.ts`: server-side siteverify (JSON POST, 5 s timeout, checks `action`). It runs only when `getRuntimeEnv('TURNSTILE_SECRET_KEY')` is set. A missing or rejected token returns 400 VALIDATION_FAILED. An unreachable siteverify returns 503 UNAVAILABLE, so the check fails closed. It guards `POST /auth/users` (action `delegate-signup`) and `POST /auth/organizers/code` (action `organizer-code`), via an optional `turnstileToken` body field (≤2048 chars).
- Web: `lib/turnstile.ts`, `components/auth/turnstile-widget.tsx`, `hooks/use-turnstile.tsx`. The widget renders only when `VITE_TURNSTILE_SITE_KEY` is set. The token resets after every request. It appears on delegate signup, organizer log-in, organizer sign-up, and code resend (resend uses `appearance: interaction-only`).
- Browser check on local ports 3102/5202 with Cloudflare's always-pass test keys: the widget rendered, the Send OTP button stayed disabled until the token arrived, a minor signup with guardian consent reached `/profile` (the real siteverify call passed), the organizer code was sent, and `/login?redirectTo=/.//evil.com` landed on `/dashboard`.

### 7. Open redirect (`53f6b3c`)
- `safeRedirectTo` rejects any raw or normalized value starting with `//` or `/\`, and falls back to `/` when parsing fails. The old function turned `/.//evil.com`, `/%2e//evil.com` and `/a/..//evil.com` into `//evil.com` (confirmed). Tests are in `web/tests/redirect.test.ts`, which the root Vitest config picks up. They sit outside `web/src` because the web project has no test runner, and Vercel's `tsc -b` would fail on a `vitest` import.

### 8. Seed guard (`cdc8f39`)
- `lib/db/seed-guard.ts`: seeding refuses unless every DATABASE_URL host (including `?host=`, and comma-separated host lists) is localhost, 127.0.0.1, ::1 or a Unix socket, or `ALLOW_REMOTE_SEED=true` is set. `seed.ts` checks this before connecting, and `seedFullGoLiveModules` checks it too. Verified: a Neon-looking URL exits 1 with a clear message.

### 9. Field encryption (`357d445`)
- New ciphertexts are written as `v1:iv:tag:data`; the legacy 3-part format is still read. Decryption pins `authTagLength: 16` and rejects any other tag or IV length. `PAYMENT_FIELD_KEY_PREVIOUS` is decrypt-only for key rotation: decryption tries the current key, then the previous one, and a malformed previous key throws. `decryptField` still has no callers.

### 10. Console notifications adapter (`e5286ff`)
- Prints full bodies only when `isProductionRuntime()` is false (`lib/runtime-platform.ts`: not Workers, detected via `navigator.userAgent === 'Cloudflare-Workers'`, and `NODE_ENV !== 'production'`). Otherwise it logs a redacted line: masked recipient and subject, with no codes or links. Verified in workerd that `isWorkersRuntime()` is true there.

### Also
- Reset links (`server/routes/password-reset.ts#resolveResetAppUrl`) were built from the request `Origin`, which an attacker controls. In production they are now always built from `APP_URL`, and a missing `APP_URL` fails the request. In local dev a loopback Origin is still honoured, then `APP_URL`, then `http://localhost:5173`.
- Reset confirm `token` is capped at 256 chars.

## Env vars / bindings for deploy
- `munhub-api` (`server/wrangler.jsonc`, already committed): the 14 `ratelimits` bindings (namespace ids 1001–1014, which must be unused elsewhere in the Cloudflare account) and `COOKIE_SECURE="true"`. `APP_URL` must stay set, because reset links now depend on it. The deploy token may need Workers rate-limit permission if Cloudflare rejects the bindings.
- Optional secret: `wrangler secret put TURNSTILE_SECRET_KEY`, **together with** `VITE_TURNSTILE_SITE_KEY` in the web build env (Vercel project and `munhub-web`). The hostnames munhub.in, www, app, organize and admin must be allowed on the Turnstile widget. Setting only the secret rejects every signup.
- Optional: `PAYMENT_FIELD_KEY_PREVIOUS`, only during a key rotation.
- Local/E2E only: `RATE_LIMIT_IP_MULTIPLIER`, `ALLOW_REMOTE_SEED`, `COOKIE_SECURE`.
- No migrations.

## Verification
- `npx vitest run --no-file-parallelism` on: lib/auth/{password,session}.test.ts, lib/actions/{auth,password-reset,organizer-otp}.test.ts, lib/crypto/field-encryption.test.ts, lib/db/seed-guard.test.ts, lib/notifications/{console-adapter-redaction,select-adapter}.test.ts, server/middleware/rate-limit.test.ts, server/lib/rate-limit-store.test.ts, server/integration/{auth-hardening,organizer-accounts}.integration.test.ts, server/integration/error-taxonomy.test.ts, server/src/app.test.ts, web/tests/redirect.test.ts — all pass.
- `server`: `tsc --noEmit` clean. `web`: `tsc -b --noEmit` clean, `oxlint` on the changed files clean, `vite build` OK. Root `tsc --noEmit`: no errors. `wrangler deploy --dry-run` lists the bindings.
- Browser check and workerd scrypt check as described above.

## Follow-ups (not done in this lane)
1. **Merge blocker (admin lane, worktree `-4`):** `lib/actions/admin-staff.ts#mintSetPasswordLink` inserts a **raw** token into `password_reset_tokens`, so its set-password links won't work with hashed lookups. This isn't a textual conflict, so the merge won't flag it. Fix: `const token = await insertPasswordResetToken(executor, userId, expiresAt)` (from `lib/actions/password-reset.ts`). Any of its tests that read the token from the DB must read the link instead.
2. **E2E (tests lane):**
   - Add `RATE_LIMIT_IP_MULTIPLIER: '1000'` to the API `webServer.env` in `E2E/playwright.config.ts`. The suite sends everything from 127.0.0.1, and the new per-IP login/signup/reset limits would throttle it.
   - `E2E/specs/auth/_helpers.ts#latestResetToken` can't read a usable token from the DB any more. Plant a known one instead: insert a row whose `token` is `sha256(known)` (`hashOpaqueToken`), then open `/reset-password?token=<known>`.
   - Comments that say "5/min per IP+email" should now say 5/min per account plus 20/min per IP.
3. **Admin two-factor auth (out of scope), sketch:**
   - TOTP (RFC 6238, HMAC-SHA1 via `node:crypto`, no new dependency) for ADMIN, SUPER_ADMIN and OPERATIONS.
   - New table `user_mfa`: `user_id` PK, `totp_secret_ciphertext` (field-encryption with its own key), `confirmed_at`, `last_used_step` for replay protection, `recovery_code_hashes`.
   - A staff password sign-in returns `{ status: 'MFA_REQUIRED', pendingToken }` (hashed, 5-minute, single-use row) instead of a session. `POST /auth/session/mfa` checks the code (±1 step, step > `last_used_step`) and only then calls `createSession`. It gets per-pending-token and per-account rate limits.
   - An enrollment page shows the QR code and asks for one confirming code. `requireRole` for staff roles rejects accounts without confirmed MFA once enforcement is switched on.
   - Recovery codes are scrypt-hashed and single-use. Resetting a staff member's MFA is a SUPER_ADMIN action with an audit log entry.
4. **CSP (sec-edge lane):** once Turnstile is enabled, the web security headers must allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`.
5. **Signup enumeration:** the signup 409 ("An account with that email already exists") still reveals whether an account exists. The per-IP limit and Turnstile limit abuse. The real fix is email-verification-first signup (notifications lane).
6. **Reset-request timing:** a known email waits for the email send, so response time can show which emails have accounts. On Workers, send through `executionCtx.waitUntil` instead.
7. **Cleanup job (devops):** periodically delete expired `sessions`, including the now-useless pre-hash rows, and old `password_reset_tokens`.
8. **Payment-field re-encryption job** after a key rotation (read with the previous key, write with the current one). Nothing does this yet; `decryptField` still has no callers by design.
9. **`web/src/pages/profile-page.tsx`** (privacy lane): the "Password changed" toast could say that other devices were signed out.
10. **Docs:** update CLAUDE.md, `server/README.md` and the web README with the new password format, session lifetime rules, rate-limit bindings, the seed guard and the new env vars.
11. **Global per-IP cap:** 300/min now also counts auth routes. Schools behind one NAT address could hit it; tune `RL_GLOBAL_IP` once there is real traffic to look at.
12. **Limit accuracy:** Workers rate limits are per-location and eventually consistent. If brute force becomes a real problem, add a DB-backed per-account lockout counter (needs a migration slot) or a Durable Object.
