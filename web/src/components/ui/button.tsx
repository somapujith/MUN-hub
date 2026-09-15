import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Airtable editorial button system (docs/prd/DESIGN-airtable.md § Buttons).
 *
 * The system documents Default and Active/Pressed only — hover is deliberately
 * restrained to a minimal tone shift, never a color change. Primary is
 * near-black {colors.primary}, NOT the link blue; that swap is the doc's most
 * emphasised "Don't".
 *
 * Variant map:
 *   default        -> button-primary          near-black, rounded-lg, 16x24
 *   outline        -> button-secondary        white + hairline outline
 *   secondary      -> button-secondary        (alias, kept for API stability)
 *   on-dark        -> button-secondary-on-dark  white block over signature cards
 *   pricing        -> button-pricing-pill     pill radius — pricing surface only
 *   legal          -> button-legal            link-blue, 2px radius, 600 weight
 *   ghost / link   -> text affordances
 *   destructive    -> coral-derived alert action
 */
const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 items-center justify-center",
    "border border-transparent bg-clip-padding whitespace-nowrap",
    "font-medium select-none outline-none",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out",
    // focus: outer blue ring (doc Elevation § "Button focus")
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // active/pressed is the only motion the system encodes
    "active:not-aria-[haspopup]:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      // NOTE on the `!` suffix on every text-color below: the `size` variants
      // carry custom font-size tokens (`text-button`, `text-body-md`,
      // `text-legal`). tailwind-merge can't tell a custom `text-*` font-size
      // token from a `text-*` color, so it puts both in one conflict group and
      // the later size class silently DELETES the variant's color — primary
      // buttons then inherited body ink (#333840) on a near-black fill: a
      // 1.2:1 contrast ratio. Marking the color important keeps it out of that
      // collapse. Don't strip these without re-checking rendered button color.
      variant: {
        // button-primary / button-primary-active
        default:
          "bg-primary text-primary-foreground! hover:bg-primary-active active:bg-primary-active",
        // button-secondary — white canvas + 1px hairline
        outline:
          "border-border bg-background text-ink! hover:bg-surface-soft active:bg-surface-strong aria-expanded:bg-surface-soft disabled:border-border-strong",
        secondary:
          "border-border bg-background text-ink! hover:bg-surface-soft active:bg-surface-strong aria-expanded:bg-surface-soft disabled:border-border-strong",
        // button-secondary-on-dark — the white block stays white over coral /
        // forest / navy signature surfaces; the system never goes translucent.
        "on-dark":
          "border-transparent bg-white text-[#181d26]! hover:bg-[#f1f2f4] active:bg-[#e0e2e6]",
        // button-pricing-pill — pricing sub-system dialect ONLY
        pricing:
          "rounded-pill! border-border bg-background font-pricing text-pricing-ink! hover:bg-surface-soft active:bg-surface-strong",
        // Inverted pricing pill — same pill/font dialect, filled instead of
        // outlined (the primary "buy this pass" action on a pricing card).
        // A dedicated variant, not a call-site override: `pricing`'s
        // `text-pricing-ink!` is `!important` (to escape the tailwind-merge
        // collision documented above), so a call site can never win a color
        // fight against it — that produced literally invisible button text
        // (ink-on-ink) on every purchasable registration pass.
        "pricing-solid":
          "rounded-pill! border-transparent bg-pricing-ink font-pricing text-background! hover:brightness-110 active:brightness-90",
        // button-legal — required system surfaces (cookie / terms)
        legal:
          "rounded-xs! bg-link text-white! hover:bg-link-active active:bg-link-active",
        ghost:
          "text-ink! hover:bg-surface-soft active:bg-surface-strong aria-expanded:bg-surface-soft dark:text-foreground! dark:hover:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground! hover:brightness-110 active:brightness-95 focus-visible:ring-destructive",
        // text-link — link blue, no underline at rest (doc § text-link)
        link: "text-link! underline-offset-4 hover:underline active:text-link-active",
      },
      size: {
        // doc: 16px vertical + 24px horizontal, 48px effective touch target
        default: "h-12 gap-2 rounded-lg px-lg text-button",
        // dense editorial/app-shell rows — keeps the 4px grid
        sm: "h-9 gap-1.5 rounded-sm px-sm text-body-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-7 gap-1 rounded-sm px-2 text-legal font-medium [&_svg:not([class*='size-'])]:size-3",
        lg: "h-14 gap-2 rounded-lg px-xl text-button",
        // button-icon-circular — exactly 40x40 per the doc
        icon: "size-10 rounded-full",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-full [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      // Base UI throws an a11y error if a non-button element is rendered while
      // nativeButton stays true — derive it whenever `render` is supplied
      // (e.g. render={<Link />}).
      nativeButton={nativeButton ?? render === undefined}
      {...props}
    />
  )
}

export { Button, buttonVariants }
