/**
 * Only a same-origin relative path survives as a post-login destination.
 */
export function safeRedirectTo(value: unknown): string {
  const raw = String(value ?? "/");
  if (!raw.startsWith("/")) return "/";

  const url = new URL(raw, "http://safe-redirect.invalid");
  return url.origin === "http://safe-redirect.invalid"
    ? `${url.pathname}${url.search}${url.hash}`
    : "/";
}
