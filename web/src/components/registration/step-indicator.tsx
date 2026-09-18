

import { CheckIcon } from "lucide-react";
import { cn } from "cn";

interface StepIndicatorProps {
  steps: readonly string[];
  current: number;
}

/**
 * Checkout step rail. The Airtable system has no documented stepper, so this is
 * built from primitives the doc does define: hairline dividers, {rounded.full}
 * markers, {typography.caption} labels, near-black ink for the active/complete
 * state. No accent colors — progress reads through fill and weight, not hue.
 */
export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <ol className="flex list-none items-center gap-xs p-0" aria-label="Registration progress">
      {steps.map((label, index) => {
        const complete = index < current;
        const active = index === current;

        return (
          // min-w-0 on this <li> and the two wrappers below lets a long label
          // (e.g. group-register-page's "Your details") ellipsis instead of
          // forcing the row past 320px — flex items default to min-width:auto
          // (their content's natural width), so without this the step rail
          // pushed the whole page into horizontal scroll at narrow widths.
          <li key={label} className="flex min-w-0 flex-1 items-center gap-xs">
            <span
              className="flex min-w-0 items-center gap-xs"
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-medium tabular-nums transition-colors",
                  complete && "border-transparent bg-primary text-primary-foreground",
                  active && "border-ink bg-background text-ink",
                  !complete && !active && "border-border bg-background text-muted-foreground",
                )}
              >
                {complete ? <CheckIcon className="size-3" aria-hidden /> : index + 1}
              </span>
              <span
                className={cn(
                  "min-w-0 overflow-hidden text-caption text-ellipsis whitespace-nowrap transition-colors",
                  active || complete ? "text-ink" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span className="sr-only">
                {complete ? "(completed)" : active ? "(current step)" : "(not started)"}
              </span>
            </span>

            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px flex-1 transition-colors",
                  complete ? "bg-ink" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
