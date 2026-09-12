"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TimerIcon } from "lucide-react";
import { cn } from "cn";

interface ReservationCountdownProps {
  /** ISO string — serializable across the server/client boundary. */
  expiresAt: string;
}

function secondsLeft(expiresAtMs: number): number {
  return Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000));
}

/**
 * Live countdown on the 15-minute seat hold that `initiateRegistration` sets.
 *
 * This mirrors real server state rather than inventing a client-side timer:
 * when it hits zero the seat really is releasable by the next lazy sweep, so
 * the component refreshes the route to let the server re-render the expired
 * branch instead of leaving a dead "Pay" button on screen.
 */
export function ReservationCountdown({ expiresAt }: ReservationCountdownProps) {
  const expiresAtMs = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const router = useRouter();

  // `null` until the first tick. Server and first client render must produce
  // identical markup, and `Date.now()` differs between them — so the initial
  // value is deliberately not computed here. `useSyncExternalStore` would also
  // work; an interval that only ever writes from its callback is simpler and
  // keeps setState out of the effect body.
  const [remaining, setRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => {
      const next = secondsLeft(expiresAtMs);
      setRemaining(next);

      if (next === 0) {
        clearInterval(interval);
        // The hold has lapsed server-side too; re-render the route so the
        // server decides what the user sees rather than leaving a stale,
        // clickable "Pay" button on screen.
        router.refresh();
      }
    };

    // First paint of the real value happens on the next frame, not during the
    // effect body, so this never triggers a cascading synchronous render.
    const raf = requestAnimationFrame(tick);
    const interval = setInterval(tick, 1000);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [expiresAtMs, router]);

  const urgent = remaining !== null && remaining <= 120;
  const label =
    remaining === null
      ? "—"
      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-md rounded-md border px-md py-sm transition-colors",
        urgent ? "border-destructive/30 bg-destructive/8" : "border-border bg-surface-soft",
      )}
    >
      <span className="flex items-center gap-xs text-body-md text-body">
        <TimerIcon
          className={cn("size-4 shrink-0", urgent ? "text-destructive-text" : "text-muted-foreground")}
          aria-hidden
        />
        Seat held for
      </span>

      <span
        // Announce sparingly — a per-second live region would flood a screen
        // reader. The remaining time is on the element for on-demand reading.
        aria-live="off"
        aria-label={
          remaining === null ? "Calculating time remaining" : `${label} remaining`
        }
        className={cn(
          "font-mono text-label-md tabular-nums",
          urgent ? "text-destructive-text" : "text-ink",
        )}
      >
        {label}
      </span>
    </div>
  );
}
