// Bridges Cloudflare Workers' `c.env` (plain `vars` + `wrangler secret put`
// values) into code that has no access to Hono's request context, for the
// same underlying platform reason lib/db/hyperdrive-bridge.ts exists: Workers
// never populate arbitrary custom vars/secrets into `process.env` — only
// `NODE_ENV` is special-cased (statically replaced at build time by
// Wrangler's bundler). A lib/ module reading `process.env.SOME_CUSTOM_VAR`
// directly always sees it as unset once deployed, no matter whether the read
// is eager or lazy, even though the value is genuinely configured in
// `wrangler.jsonc`/as a secret.
//
// `server/middleware/runtime-env.ts` calls `setRuntimeEnv(c.env)` on every
// request. Local Node dev/tests never call it, so `getRuntimeEnv()` falls
// back to real `process.env`, unchanged from before this file existed.

let bridgedEnv: Record<string, string | undefined> = {}

export function setRuntimeEnv(env: Record<string, string | undefined>): void {
  bridgedEnv = env
}

export function getRuntimeEnv(key: string): string | undefined {
  return bridgedEnv[key] ?? process.env[key]
}
