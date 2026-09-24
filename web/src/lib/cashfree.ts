/**
 * Cashfree's hosted checkout (docs/payments/CASHFREE.md). Cashfree has no
 * plain redirect URL — the browser loads Cashfree's own JS SDK and calls
 * `cashfree.checkout({ paymentSessionId, redirectTarget: "_self" })`, which
 * performs the actual full-page redirect. Same "load a provider script once
 * per page" pattern as web/src/lib/turnstile.ts.
 */

/** "sandbox" | "production", build-time — matches the server's CASHFREE_ENV. Defaults to production. */
export const CASHFREE_MODE: "sandbox" | "production" =
  import.meta.env.VITE_CASHFREE_ENV === "sandbox" ? "sandbox" : "production";

const SCRIPT_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

export interface CashfreeCheckoutOptions {
  paymentSessionId: string;
  redirectTarget: "_self";
}

export interface CashfreeInstance {
  checkout(options: CashfreeCheckoutOptions): Promise<unknown>;
}

type CashfreeFactory = (config: { mode: "sandbox" | "production" }) => CashfreeInstance;

declare global {
  interface Window {
    Cashfree?: CashfreeFactory;
  }
}

let scriptPromise: Promise<CashfreeFactory> | null = null;

/**
 * Marks that this browser actually redirected to Cashfree's hosted page for
 * `registrationId` — set right before `cashfree.checkout(...)` is called.
 * `redirectTarget: "_self"` is a full top-level navigation away from the app,
 * so any in-memory React state is lost; sessionStorage is what lets the pay
 * page tell "first visit, about to pay" apart from "just came back from
 * Cashfree, waiting on the webhook" after the browser returns to
 * `return_url` as a fresh page load. Survives a manual reload too (unlike
 * component state), which matters since a waiting user is exactly the kind
 * of person who might hit refresh.
 */
export function markCashfreeCheckoutStarted(registrationId: string): void {
  try {
    sessionStorage.setItem(`cashfree_checkout_started_${registrationId}`, "1");
  } catch {
    // Private browsing / storage disabled — the pay page falls back to
    // showing the checkout card again, same as before this existed.
  }
}

export function hasCashfreeCheckoutStarted(registrationId: string): boolean {
  try {
    return sessionStorage.getItem(`cashfree_checkout_started_${registrationId}`) === "1";
  } catch {
    return false;
  }
}

export function clearCashfreeCheckoutStarted(registrationId: string): void {
  try {
    sessionStorage.removeItem(`cashfree_checkout_started_${registrationId}`);
  } catch {
    // Nothing to clean up if storage isn't available in the first place.
  }
}

/** Loads Cashfree's script once per page, on first use. */
export function loadCashfreeSdk(): Promise<CashfreeFactory> {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  scriptPromise ??= new Promise<CashfreeFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error("Cashfree SDK did not initialise")));
    script.onerror = () => reject(new Error("Cashfree SDK failed to load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // Let a later mount try again (e.g. after a flaky network).
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}
