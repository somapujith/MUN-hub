import { cn } from "cn"

/**
 * Loading placeholder. Uses the {colors.surface-soft} / {colors.surface-strong}
 * pair and {rounded.sm} so skeletons read as the same material as the inputs
 * and cards they stand in for. Motion is suppressed under
 * prefers-reduced-motion by the global rule in globals.css.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-sm bg-surface-strong/60 dark:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
