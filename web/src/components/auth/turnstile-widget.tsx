import * as React from "react";
import { useTheme } from "next-themes";
import {
  TURNSTILE_SITE_KEY,
  loadTurnstile,
  type TurnstileAction,
  type TurnstileApi,
  type TurnstileAppearance,
} from "@/lib/turnstile";

/**
 * One Cloudflare Turnstile widget. Use it through `useTurnstile`
 * (hooks/use-turnstile.tsx), which owns the token and the reset signal.
 */
export function TurnstileWidget({
  action,
  appearance,
  resetSignal,
  onToken,
}: {
  action: TurnstileAction;
  appearance: TurnstileAppearance;
  /** Bump after each submission: tokens are single-use. */
  resetSignal: number;
  onToken: (token: string | null) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | undefined>(undefined);
  const onTokenRef = React.useRef(onToken);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  React.useEffect(() => {
    onTokenRef.current = onToken;
  });

  React.useEffect(() => {
    const sitekey = TURNSTILE_SITE_KEY;
    if (!sitekey) return;
    let cancelled = false;
    let api: TurnstileApi | undefined;

    loadTurnstile().then(
      (loaded) => {
        if (cancelled || !containerRef.current) return;
        api = loaded;
        widgetIdRef.current = loaded.render(containerRef.current, {
          sitekey,
          action,
          theme,
          appearance,
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = undefined;
      if (api && widgetId) api.remove(widgetId);
      onTokenRef.current(null);
    };
  }, [action, appearance, theme]);

  React.useEffect(() => {
    const widgetId = widgetIdRef.current;
    if (resetSignal > 0 && widgetId) window.turnstile?.reset(widgetId);
  }, [resetSignal]);

  if (loadFailed) {
    return (
      <p role="alert" className="text-body-md text-destructive-text">
        The verification check couldn&apos;t load. Check your connection and reload the page.
      </p>
    );
  }

  // Reserve the managed widget's height so the form doesn't jump when it appears.
  return <div ref={containerRef} className={appearance === "always" ? "min-h-[65px]" : undefined} />;
}
