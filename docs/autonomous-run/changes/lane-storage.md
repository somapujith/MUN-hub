# Lane: storage — uploaded files are stored and served

Lead: mun-hub-62. Branch `worktree-agent-ab45645de97cab373` (fast-forwarded to `main` at `f523604` before starting).

Commits:
- `567b428` feat(storage): KV, R2 and filesystem adapters behind request-scoped selection
- `f44b53e` feat(storage): check upload signatures and size caps; store uploads for real
- `04d961c` feat(server): serve uploaded files at /api/v1/files/:key; bind UPLOADS_KV
- this file

## Problem

`lib/storage` only had a mock adapter. It returned `/mock-storage/<key>` URLs and threw the bytes away. `lib/actions/mun-branding.ts` and `lib/actions/mun-documents.ts` uploaded through it, so organizer logos, covers and PDF documents never showed up anywhere. R2 is not enabled on the Cloudflare account (API error 10042). Workers KV works.

## What changed

### Storage adapters (`lib/storage/`)

| File | Purpose |
|---|---|
| `adapter.ts` | `StorageAdapter` gains `get(key)`, which returns `{ body, contentType, size, sha256?, uploadedAt? }` or `null`. |
| `kv-adapter.ts` | Workers KV (binding `UPLOADS_KV`). The value is the bytes. The KV metadata holds `contentType`, `size`, `sha256` and `uploadedAt`. Reads come back as a stream. Values over 25 MiB are refused. |
| `r2-adapter.ts` | R2 (binding `UPLOADS_BUCKET`), ready for when R2 is enabled. The content type goes in `httpMetadata`, and `sha256`/`uploadedAt` go in `customMetadata`. The `sha256` is also passed to `put`, so R2 checks the bytes arrived intact. |
| `local-adapter.ts` | Filesystem, used when `STORAGE_ADAPTER=local` (Node dev). Files go under `<repo>/.local-uploads/` (now gitignored; override with `LOCAL_UPLOADS_DIR`). Bytes are in `objects/<key>`, metadata in `meta/<key>.json`. `node:fs` is imported lazily, so the Worker never loads it. |
| `mock-adapter.ts` | Unchanged behaviour, still used by tests. `get` returns `null`. |
| `bindings.ts` | Request-scoped bridge for the bindings and the request origin. It uses `AsyncLocalStorage`, the same pattern as `lib/db/hyperdrive-bridge.ts`, and nothing is cached at module scope. It also defines minimal `KvNamespaceLike`/`R2BucketLike` interfaces, because the repo has no `@cloudflare/workers-types`. |
| `select-adapter.ts` | `selectStorageAdapter()` is called per operation. It picks the first available of: **R2 → KV → local → mock**. With both R2 and KV bound, uploads go to R2, reads try R2 then KV, and deletes hit both (this is the migration path). If production falls back to the mock, it logs `console.error` on every call. `deleteStoredObjectQuietly()` is a best-effort delete that logs instead of throwing. |
| `keys.ts` | `isSafeStorageKey()`: 2+ segments of `[A-Za-z0-9._-]`, no segment starting with `.`, ≤ 512 bytes. Every adapter and the files route check it. `publicFileUrl(key)` builds the URL the web app uses (see below). |
| `validate.ts` | Upload validation (below). |
| `object-metadata.ts` | SHA-256 via Web Crypto, and metadata build/parse helpers. |
| `in-memory-bindings.ts` | In-memory KV/R2 fakes and sample file headers, for tests only. |

### Server

- **`server/middleware/storage.ts`:** reads `c.env.UPLOADS_BUCKET` / `c.env.UPLOADS_KV` (duck-typed) and the request origin. It runs the rest of the request inside the storage scope.
- **`server/src/app.ts`:** two additive changes.
  - Registers the storage middleware right after `hyperdriveMiddleware`.
  - Mounts `app.route('/api/v1/files', filesRoutes)` just before `app.route('/api/v1', apiV1)`, so the route sits behind CSRF and rate limiting like everything else.
- **`server/routes/files.ts`:** `GET /api/v1/files/:key{.+}`, public.
  - It returns 404 with `Cache-Control: no-store` for unsafe or missing keys. `no-store` matters because KV is eventually consistent.
  - Headers on a successful response:
    - `Content-Type`: the stored type, but only if it is one of the four validated types. Anything else is served as an `application/octet-stream` attachment.
    - `X-Content-Type-Options: nosniff`.
    - `Content-Disposition: inline; filename="<uuid>.<ext>"`.
    - `Cache-Control: public, max-age=31536000, immutable`.
    - `ETag: "<sha256>"`, and a matching `If-None-Match` gets a 304.
    - `Cross-Origin-Resource-Policy: cross-origin`.
    - `Content-Length`.
    - CSP (see decisions): images get `default-src 'none'; sandbox`, PDFs get `default-src 'none'; object-src 'self'`.

### Upload validation (`lib/storage/validate.ts`)

The checks run in this order:
1. **Content type allowlist:** PNG, JPEG or WebP for images; PDF for documents. SVG, HTML, GIF and everything else are rejected.
2. **Size:** the file must be non-empty and within its cap.
3. **Magic bytes:** they must match the declared type. The signatures are `%PDF-` at offset 0, the PNG signature, `FF D8 FF` for JPEG, and `RIFF` + `WEBP` at offset 8 for WebP.

Size caps. Where the old limits and the requested ones differed, the stricter wins:

| Kind | Cap | Before |
|---|---|---|
| `LOGO`, `ORGANIZER_LOGO`, `SPONSOR` | 2MB | 5MB |
| `COVER`, `GALLERY` | 5MB | 5MB |
| Documents (PDF) | 10MB | 20MB |

The error messages are worded to match patterns that `server/middleware/error.ts` already maps to **400 VALIDATION_FAILED**. `error.ts` was not edited. `lib/storage/validate.test.ts` checks that mapping, so a change to `error.ts` that breaks it fails a test.
- `Unsupported content type "…" — allowed types are …`
- `File too large (N bytes) — maximum allowed size is 2MB|5MB|10MB`
- `The file is empty — a non-empty file is required`
- `The file's contents do not match its declared type (image/png) — a valid PNG image is required`

The errors are thrown as `UploadValidationError`.

### Upload actions (small edits; HTTP contracts unchanged)

`POST /muns/:munId/media` `{kind, contentType, fileBase64, displayOrder?}` and `POST /muns/:munId/documents` `{kind, title, contentType, fileBase64}` still accept the same request bodies. Responses have the same shape, but `url` now points at the files route.

- Both actions call `validateUpload(...)` and `selectStorageAdapter()` instead of their local validators and the hard-wired mock.
- **Rollback:** if the DB insert fails after the bytes were written, the new object is deleted again (best effort).
- **Delete:** `deleteMunMedia` / `deleteMunDocument` delete the object after the row is gone. This is best effort and logged, so a storage outage no longer turns a successful row delete into a 500.
- **Replace (LOGO/COVER upsert):** replaced objects are deleted *after* the transaction commits. Before, this happened inside the transaction callback.
- **Race fix:** the upsert transaction now row-locks the mun (`SELECT … FOR UPDATE`). Without the lock, concurrent logo uploads each saw "no existing logo" and left several LOGO rows. The new test reproduced 4 rows from 5 uploads with the lock removed, and exactly 1 with it.

### Config

- **`server/wrangler.jsonc`:** all edits are additive.
  - `vars.PUBLIC_API_URL = "https://api.munhub.in"`.
  - A `kv_namespaces` entry `UPLOADS_KV` with the placeholder id `REPLACE_WITH_UPLOADS_KV_ID`.
  - A commented-out `r2_buckets` example (`UPLOADS_BUCKET`).
- **`.env.example`:** documents `STORAGE_ADAPTER` (`local` | `mock`; the template now says `local` for dev), `LOCAL_UPLOADS_DIR` and `PUBLIC_API_URL`. `.env` and `.env.test` are unchanged (`.env.test` keeps `mock`).
- **`.gitignore`:** adds `.local-uploads/`.

## Decisions

1. **URLs are absolute and built at upload time.** The web app and the API are on different origins in production (`organize.munhub.in` vs `api.munhub.in`) and in dev (`:5174` vs `:3001`). The web app renders `url` directly (`documents-page.tsx` uses `<a href={document.url}>`). `publicFileUrl` builds the URL from the first of these that is set:
   1. `PUBLIC_API_URL`, reduced to its origin.
   2. The origin of the upload request. In dev this gives `http://localhost:3001/...`, so nothing needs configuring.
   3. A root-relative path, used outside a request (scripts, tests).

   `storageKey` is stored on the row as well, so the URL can be rebuilt if the API host ever changes.
2. **Public access relies on unguessable keys.** Keys are `muns/<munId>/<area>/<random UUID>`. Anyone holding a URL can fetch the file. Two consequences:
   - A draft MUN's file URLs are discoverable through the unauthenticated `GET /muns/:munId/media|documents` lists until the sec-edge lane's published-or-owner guards land.
   - No private files (delegate uploads, ID documents) exist yet. When they do, they need an authorization check in the files route, not just a key.
3. **PDFs are served without `sandbox` (a deviation from the brief).** A sandboxed document may not load plugins, and Chrome counts its PDF viewer as one, so `sandbox` would block inline PDFs. PDFs get `default-src 'none'; object-src 'self'` plus `nosniff` and an exact `Content-Type`. Upload validation guarantees the bytes start with `%PDF-`. Images keep `default-src 'none'; sandbox`. Neither CSP has been checked in a real browser (see follow-ups).
4. **The cache is immutable for a year.** A key is never reused, so a cached copy is never stale. The trade-off: a deleted file can survive in browser caches. Cloudflare does not cache Worker responses by default, so this only affects browsers.
5. **The production fallback to the mock logs and keeps going, as the brief asked.** It does not refuse the upload. The downside is that uploads would silently vanish if the binding were ever missing, so the lead should check the log after deploying.
6. **A 10MB document cap.** It is stricter than the old 20MB, and it keeps a base64 JSON body (about 13.4MB, held as a string plus the decoded buffer) comfortably inside a Worker's 128MB memory.
7. **The mock stays the default when `STORAGE_ADAPTER` is unset**, so tests and existing setups behave exactly as before.

## Deploy steps (lead)

1. Create the namespace from `server/`:
   ```sh
   npx wrangler kv namespace create munhub-uploads
   ```
   Paste the printed `id` into `server/wrangler.jsonc` in place of `REPLACE_WITH_UPLOADS_KV_ID`. **`wrangler deploy` fails while the placeholder is there.**
2. `PUBLIC_API_URL` is already in `vars`. No new secrets are needed.
3. Deploy `munhub-api`. Then upload a logo on a sandbox MUN and check:
   - the returned `url` starts with `https://api.munhub.in/api/v1/files/muns/`;
   - fetching it returns the image with the headers above;
   - the Worker logs don't show `[storage] No UPLOADS_BUCKET or UPLOADS_KV binding in production`.
4. No migration is needed; the schema is unchanged. Rows uploaded before this change still carry `/mock-storage/...` URLs and have no bytes behind them. Those files need uploading again. Seeded rows use placeholder `placehold.co` URLs and are unaffected.

## Moving from KV to R2 later

1. Enable R2 on the account and create the bucket:
   ```sh
   npx wrangler r2 bucket create munhub-uploads
   ```
2. Uncomment the `r2_buckets` block (`UPLOADS_BUCKET`) and **keep `UPLOADS_KV`**, then deploy. New uploads go to R2. Reads try R2 first and fall back to KV, so older files keep working. Deletes remove the key from both.
3. Optional: copy the KV objects to R2 with a one-off script. Keys are identical, so for each key, read it from KV with its metadata and `put` it to R2 with the same content type and sha256. Then remove the `UPLOADS_KV` binding.

URLs don't change, because they only contain the key.

## Verification

Worktree: `A:\Coding\Projects\Mun-hub\MUN-hub\.claude\worktrees\agent-ab45645de97cab373`. Tests ran against local Docker Postgres via `.env.test`.

**Type checks and bundle:**
- `cd server && npx tsc --noEmit -p tsconfig.json`: clean.
- Root `npx tsc --noEmit -p tsconfig.json --incremental false`: clean.
- The integration test file was also type-checked with a temporary tsconfig: clean.
- `cd server && npx wrangler deploy --dry-run --outdir <tmp>`: the bundle builds (1289 KiB), with `UPLOADS_KV` and `PUBLIC_API_URL` bound.

**Tests:**
```sh
npx vitest run lib/storage lib/actions/mun-branding.test.ts lib/actions/mun-documents.test.ts \
  lib/lifecycle/module-locking.test.ts server/routes/files.test.ts server/integration/files.integration.test.ts \
  server/integration/error-taxonomy.test.ts server/src/app.test.ts server/integration/mun-config.integration.test.ts \
  server/integration/go-live.integration.test.ts server/integration/organizer-onboarding.integration.test.ts \
  --no-file-parallelism
```
Result: 17 files, 139 tests passed. The logo race test was run 5× in a row and passed each time. With the lock removed it failed 3 out of 3 runs, so it does catch the bug.

**Real Workers runtime:** `wrangler dev --local` on port 8799, with local KV simulation and Hyperdrive pointed at local Docker. A scratch smoke script passed 25/25 checks:
- upload a logo; confirm the URL uses `PUBLIC_API_URL` from `vars`;
- GET returns the same bytes and every header above; a matching ETag gets 304;
- 25 concurrent GETs all return the full bytes;
- replacing the logo removes the old object;
- a PDF uploads, is served with the right headers, is deleted, then 404s;
- a mislabelled SVG gets 400 VALIDATION_FAILED;
- a traversal key gets 404.

The Worker log showed no errors.

**Node dev path:** `tsx src/index.ts` on port 8798 with `STORAGE_ADAPTER=local` passed the same 25 checks. URLs came from the request origin (`http://127.0.0.1:8798/...`), and deleted files were removed from disk.

## Follow-ups (other lanes)

- **f1 (documents page):** `web/src/pages/organizer/dashboard/sections/documents-page.tsx` still says "max 20MB" and checks 20MB client-side. The server now enforces 10MB and returns a clean 400 message. The label is left alone because the E2E specs select on `'PDF file (max 20MB)'`. Update the label and the E2E selector together (f1 + tests lane).
- **f1 (branding UI):** render `media.url` directly in `<img>`; it is already absolute. Client-side caps are 2MB for logos and 5MB for covers.
- **sec-edge:**
  - If a global secure-headers middleware is added, it must not overwrite the files route's `Content-Security-Policy` or `Cross-Origin-Resource-Policy: cross-origin`. `same-origin` would break `<img>` on munhub.in.
  - Any JSON body limit must allow roughly 14MB on `POST /muns/:munId/documents` (10MB base64-encoded).
  - The published-or-owner guards on the media/documents lists also close the draft-file discoverability gap (decision 2).
- **privacy lane:** account or MUN deletion cascades `mun_media`/`mun_documents` rows. Collect their `storageKey`s first and call `deleteStoredObjectQuietly` for each, or the objects are orphaned.
- **Error mapping (whoever owns `server/middleware/error.ts`):** optionally map `instanceof UploadValidationError` to 400 explicitly, instead of relying on the message patterns. `mun-documents.ts`'s old unmapped message ("only application/pdf is allowed") is gone.
- **tests lane:**
  - The E2E API could run with `STORAGE_ADAPTER=local` and `LOCAL_UPLOADS_DIR` set to a temp dir, then fetch the returned URLs.
  - The existing E2E fixtures (a real 1×1 PNG and a real `%PDF-1.4` header) still pass validation.
- **Browser check:** open an uploaded PDF and image in Chrome and Firefox once deployed, to confirm the CSP choice in decision 3.
- **Not done:**
  - Nicer download filenames: documents are served as `<uuid>.pdf`. Using the document title would mean the files route reading the DB.
  - A sweep for orphaned objects.
