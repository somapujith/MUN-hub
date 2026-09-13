import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Shared textarea styling + hint text for this module's two dialogs.
 *
 * `components/ui/input.tsx` covers `<input>` only, and there is no Textarea
 * primitive in `components/ui/`. Rather than add one (that's a shared-primitive
 * decision, not a module one), this mirrors the exact Input token set —
 * `{rounded.sm}`, hairline border, `{typography.body-md}`, `--ring` focus —
 * so the two field types are visually indistinguishable. Matches the same
 * local pattern in `app/admin/review/review-decision-dialog.tsx`.
 */
export const fieldClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

export function FieldHint({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] leading-[1.35] text-muted-foreground">
      {children}
    </p>
  );
}
