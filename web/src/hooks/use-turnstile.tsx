import * as React from "react";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { TURNSTILE_SITE_KEY, type TurnstileAction, type TurnstileAppearance } from "@/lib/turnstile";

/**
 * Cloudflare Turnstile for a form (see lib/turnstile.ts). Put `widget` in
 * the form — it is null when Turnstile is off — send `token` with the
 * request, call `reset()` once the request settles (tokens are single-use),
 * and hold the submit until `ready`. With no site key configured the hook is
 * always ready and the token is undefined.
 */
export function useTurnstile(action: TurnstileAction, options: { appearance?: TurnstileAppearance } = {}) {
  const [token, setToken] = React.useState<string | null>(null);
  const [resetSignal, setResetSignal] = React.useState(0);
  const appearance = options.appearance ?? "always";

  const reset = React.useCallback(() => {
    setToken(null);
    setResetSignal((count) => count + 1);
  }, []);

  const widget = TURNSTILE_SITE_KEY ? (
    <TurnstileWidget action={action} appearance={appearance} resetSignal={resetSignal} onToken={setToken} />
  ) : null;

  return {
    enabled: Boolean(TURNSTILE_SITE_KEY),
    token: token ?? undefined,
    ready: !TURNSTILE_SITE_KEY || token !== null,
    widget,
    reset,
  };
}
