import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Tabs — retuned from the shadcn `base-nova` baseline onto this project's
 * Airtable token set (DESIGN-airtable.md). Three deviations from stock, all
 * deliberate:
 *
 *   1. Type is `{typography.body-md}` (14/400) and `{typography.caption}`
 *      weights, not Tailwind's `text-sm`. Every other surface in this app
 *      reads from the doc's type ramp; a tab strip in `text-sm` is the one
 *      thing that would look imported.
 *   2. `line` (the underline strip) is the variant workspace sub-navigation
 *      uses — the doc's elevation rule is "color-block first, shadow second",
 *      and a filled pill segmented control reads as a control, not as
 *      navigation. Stock's `default` filled variant is kept for genuinely
 *      switch-like uses.
 *   3. Radius follows the doc scale ({rounded.sm} 6px for tab targets,
 *      {rounded.md} 10px for the filled track) instead of stock's `rounded-lg`
 *      /`rounded-md` pairing.
 *
 * Tab targets are 40px tall in `line` — above the workspace's dense-row floor
 * and close enough to the 44px touch target that the 8px inter-tab gap
 * compensates.
 */

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-lg data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  [
    "group/tabs-list inline-flex items-center text-muted-foreground",
    "group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  ],
  {
    variants: {
      variant: {
        // Filled segmented track — for switching a view, not for navigation.
        default:
          "w-fit justify-center gap-xxs rounded-md bg-surface-soft p-xxs dark:bg-muted",
        // Underline strip — section sub-navigation. Sits on a hairline rule
        // that runs the full content width so the strip reads as a boundary
        // between the header and the panel, not as a floating group.
        line: "w-full justify-start gap-xs border-b border-border group-data-vertical/tabs:w-fit group-data-vertical/tabs:border-b-0 group-data-vertical/tabs:border-r",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-xs whitespace-nowrap",
        "text-body-md font-medium text-body transition-[color,background-color,box-shadow] duration-150 ease-out",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "dark:text-muted-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // -- filled variant -----------------------------------------------
        "group-data-[variant=default]/tabs-list:h-9 group-data-[variant=default]/tabs-list:flex-1",
        "group-data-[variant=default]/tabs-list:rounded-sm group-data-[variant=default]/tabs-list:px-md",
        "group-data-[variant=default]/tabs-list:hover:text-ink",
        "group-data-[variant=default]/tabs-list:data-active:bg-background group-data-[variant=default]/tabs-list:data-active:text-ink",
        "dark:group-data-[variant=default]/tabs-list:data-active:bg-card dark:group-data-[variant=default]/tabs-list:data-active:text-foreground",
        // -- line variant ---------------------------------------------------
        "group-data-[variant=line]/tabs-list:h-10 group-data-[variant=line]/tabs-list:rounded-t-sm",
        "group-data-[variant=line]/tabs-list:px-sm",
        "group-data-[variant=line]/tabs-list:hover:bg-surface-soft group-data-[variant=line]/tabs-list:hover:text-ink",
        "dark:group-data-[variant=line]/tabs-list:hover:bg-muted",
        "group-data-[variant=line]/tabs-list:data-active:text-ink dark:group-data-[variant=line]/tabs-list:data-active:text-foreground",
        // The active rule. Sits ON the list's border-b (bottom:-1px) so it
        // overpaints the hairline rather than stacking a second line under it.
        "after:pointer-events-none after:absolute after:bg-primary after:opacity-0 after:transition-opacity dark:after:bg-foreground",
        "group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-0.5",
        "group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-px group-data-vertical/tabs:after:w-0.5",
        "group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-body-md outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
