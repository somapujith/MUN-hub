const SAFE_BASE = "http://safe-redirect.invalid";

/**
 * A path that a browser or the router could read as protocol-relative
 * (`//host`, and `/\host`, which browsers treat the same way).
 */
function looksProtocolRelative(path: string): boolean {
  return path.startsWith("//") || path.startsWith("/\\");
}

/**
 * Only a same-origin relative path survives as a post-login destination;
 * anything else becomes "/".
 *
 * The check runs on the raw value AND on the normalized result: URL
 * parsing collapses dot segments and decodes `%2e`, so `/.//evil.com` or
 * `/%2e//evil.com` normalize to `//evil.com`, which would navigate
 * off-site even though the raw value looked like a plain path.
 */
export function safeRedirectTo(value: unknown): string {
  const raw = String(value ?? "/");
  if (!raw.startsWith("/") || looksProtocolRelative(raw)) return "/";

  let url: URL;
  try {
    url = new URL(raw, SAFE_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== SAFE_BASE) return "/";

  const result = `${url.pathname}${url.search}${url.hash}`;
  return result.startsWith("/") && !looksProtocolRelative(result) ? result : "/";
}
