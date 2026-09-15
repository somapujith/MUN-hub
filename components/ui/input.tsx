import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

/**
 * `text-input` — docs/prd/DESIGN-airtable.md § Inputs & Forms.
 * Canvas background, {colors.ink} text, {typography.body-md}, {rounded.sm}
 * (6px), 12px x 16px padding, 44px height, 1px {colors.hairline} border.
 * Focus recolors the border to {colors.info-border} (`--ring`).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-sm border border-input bg-background px-md py-sm text-base text-ink transition-colors outline-none md:text-body-md",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body-md file:font-medium file:text-ink",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "dark:bg-card",
        className
      )}
      {...props}
    />
  )
}

export { Input }
