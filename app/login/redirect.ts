/**
 * Only a same-origin relative path survives as a post-login destination.
 * `redirectTo` arrives from client-controlled input (a form field or query
 * string), so this must be resolved with a real URL parser rather than a
 * prefix check — `path.startsWith("/") && !path.startsWith("//")` still lets
 * `/\evil.com` through, because the WHATWG URL parser (which browsers apply
 * to redirect targets) treats a leading backslash the same as a slash and
 * resolves it to the `evil.com` origin.
 */
export function safeRedirectTo(value: unknown): string {
  const raw = String(value ?? "/");
  if (!raw.startsWith("/")) return "/";

  const url = new URL(raw, "http://safe-redirect.invalid");
  return url.origin === "http://safe-redirect.invalid"
    ? `${url.pathname}${url.search}${url.hash}`
    : "/";
}
