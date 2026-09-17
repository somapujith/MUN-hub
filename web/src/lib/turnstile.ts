/**
 * Cloudflare Turnstile bot check for public forms (delegate signup,
 * organizer sign-in codes). The widget renders only when
 * VITE_TURNSTILE_SITE_KEY is set at build time; the API enforces it only
 * when TURNSTILE_SECRET_KEY is set (server/lib/turnstile.ts), so configure
 * both together. See hooks/use-turnstile.tsx.
 */
export const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Must match TURNSTILE_ACTIONS in server/lib/turnstile.ts. */
export type TurnstileAction = "delegate-signup" | "organizer-code";

export type TurnstileAppearance = "always" | "interaction-only";

export interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme: "light" | "dark";
  appearance: TurnstileAppearance;
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page, on first use. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not initialise"));
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // Let a later mount try again (e.g. after a flaky network).
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}
