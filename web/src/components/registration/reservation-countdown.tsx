import * as React from "react";
import { useNavigate } from "react-router";
import { TimerIcon } from "lucide-react";
import { cn } from "cn";

interface ReservationCountdownProps {
  expiresAt: Date;
}

function secondsLeft(expiresAtMs: number): number {
  return Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000));
}

export function ReservationCountdown({ expiresAt }: ReservationCountdownProps) {
  const expiresAtMs = React.useMemo(() => expiresAt.getTime(), [expiresAt]);
  const navigate = useNavigate();
  const [remaining, setRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => {
      const next = secondsLeft(expiresAtMs);
      setRemaining(next);
      if (next === 0) {
        clearInterval(interval);
        navigate(0);
      }
    };
    const raf = requestAnimationFrame(tick);
    const interval = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [expiresAtMs, navigate]);

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
        aria-live="off"
        aria-label={remaining === null ? "Calculating time remaining" : `${label} remaining`}
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
