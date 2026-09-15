import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Badge / tag. The Airtable system has no documented badge component beyond the
 * article-card "small uppercase category tag" and the topic-rail count badge —
 * so this follows those: {rounded.sm} (6px) for tags, hairline outline, and
 * {typography.caption} sizing. Status tones keep the 15%-tint + dedicated
 * `-text` token pairing the app already relies on.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-[12px] leading-[1.35] font-medium tracking-[0.16px] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-active",
        secondary: "bg-surface-soft text-body [a]:hover:bg-surface-strong",
        outline:
          "border-border bg-background text-body [a]:hover:bg-surface-soft",
        ghost: "text-muted-foreground [a]:hover:bg-surface-soft",
        link: "text-link underline-offset-4 hover:underline",
        /* status tones — 15% tint field + dedicated readable text token */
        destructive:
          "bg-destructive/12 text-destructive-text [a]:hover:bg-destructive/20",
        success: "bg-success/12 text-success-text [a]:hover:bg-success/20",
        warning: "bg-warning/20 text-warning-text [a]:hover:bg-warning/30",
        info: "bg-info/12 text-info-text [a]:hover:bg-info/20",
        /* signature accents — for editorial category tags, not status */
        coral: "bg-signature-coral/12 text-signature-coral",
        forest: "bg-signature-forest/12 text-signature-forest",
        cream: "bg-signature-cream text-[#181d26]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
