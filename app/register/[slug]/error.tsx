"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RegistrationNotice } from "@/components/registration/registration-notice";

/**
 * Route-level error boundary for the whole registration funnel.
 *
 * `getRegistrationById`'s `Forbidden` throw is handled at each call site
 * (`confirmation/page.tsx`, `pay/page.tsx`) rather than here: Next.js redacts
 * thrown error messages before they reach a client error boundary in
 * production, so `error.message === 'Forbidden'` is dead code in prod (only
 * `error.digest` survives) and would silently misrender an authorization
 * denial as a generic transient error. This boundary only ever sees genuinely
 * unexpected failures, and never echoes the raw error message back to the
 * user.
 */
export default function RegisterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[register] route error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xl sm:px-xl">
      <RegistrationNotice
        tone="error"
        title="Something went wrong"
        message="We hit an unexpected error handling your registration. No payment has been taken. Try again — if a seat was held, it releases automatically after 15 minutes."
      >
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" render={<Link href="/muns" />}>
          Browse MUNs
        </Button>
      </RegistrationNotice>
    </main>
  );
}
