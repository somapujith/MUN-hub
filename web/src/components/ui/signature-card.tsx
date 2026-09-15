import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Signature surface cards — the brand's voltage moments
 * (docs/prd/DESIGN-airtable.md § Cards & Containers).
 *
 * These are full-bleed color surfaces that punctuate a long-scroll editorial
 * page every two or three screens. They are NOT accents on small elements —
 * the doc is explicit: "They appear as full-bleed, full-card surfaces — never
 * as accents on a small element."
 *
 * Pacing rule for page authors: never place two of the same surface mode in
 * consecutive bands. The intended rhythm is
 *   white -> signature -> white -> cream -> dark -> white.
 *
 * Elevation: flat. No shadow, no border. Depth comes from color contrast with
 * the white canvas ("color-block first, shadow second").
 *
 * Variants:
 *   coral  -> signature-coral-card   #aa2d00, rounded-lg (12px), padding 48px
 *   forest -> signature-forest-card  #0a2e0e, rounded-lg (12px), padding 48px
 *   dark   -> hero-card-dark         #181d26, rounded-lg (12px), padding 48px
 *   cream  -> cream-callout-card     #f5e9d4, rounded-md (10px), padding 24px
 *   soft   -> feature-card-tabbed    #f8fafc, rounded-lg (12px), padding 32px
 *   strong -> cta-band-light         #e0e2e6, rounded-lg (12px), padding 48px
 */
const signatureCardVariants = cva(
  "relative isolate flex w-full flex-col overflow-hidden",
  {
    variants: {
      variant: {
        coral: "rounded-lg bg-signature-coral text-white",
        forest: "rounded-lg bg-signature-forest text-white",
        // `surface-dark` (#181d26 light / #0d1218 dark) is built to contrast
        // against a white canvas. In dark mode the page canvas itself is
        // #181d26, so `surface-dark`'s own dark-mode value (#0d1218, even
        // darker) sits at ~1.2:1 against it and the card visually disappears.
        // `surface-strong` in dark mode (#2c3038) is a real step up from
        // canvas, so this variant borrows it there instead.
        dark: "rounded-lg bg-surface-dark text-on-dark dark:bg-surface-strong dark:text-foreground",
        cream: "rounded-md bg-signature-cream text-[#181d26]",
        soft: "rounded-lg bg-surface-soft text-ink",
        strong: "rounded-lg bg-surface-strong text-[#181d26]",
      },
      // Doc § Layout "Card internal padding": 48px inside signature coral /
      // forest / dark cards, 32px for tabbed feature + pricing cards, 24px for
      // cream callouts and demo-grid cards.
      padding: {
        none: "p-0",
        sm: "p-md",
        md: "p-lg",
        lg: "p-xl",
        xl: "p-lg sm:p-xl lg:p-xxl",
      },
    },
    defaultVariants: {
      variant: "coral",
      padding: "xl",
    },
  }
)

/** Per-variant default padding, matching each component spec in the doc. */
const defaultPaddingFor: Record<
  NonNullable<VariantProps<typeof signatureCardVariants>["variant"]>,
  NonNullable<VariantProps<typeof signatureCardVariants>["padding"]>
> = {
  coral: "xl",
  forest: "xl",
  dark: "xl",
  cream: "md",
  soft: "lg",
  strong: "xl",
}

function SignatureCard({
  className,
  variant = "coral",
  padding,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof signatureCardVariants>) {
  const resolvedPadding = padding ?? defaultPaddingFor[variant ?? "coral"]

  return (
    <div
      data-slot="signature-card"
      data-variant={variant}
      className={cn(
        signatureCardVariants({ variant, padding: resolvedPadding }),
        className
      )}
      {...props}
    />
  )
}

/** Eyebrow / category tag above a signature headline. */
function SignatureCardEyebrow({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="signature-card-eyebrow"
      className={cn(
        "mb-md text-caption uppercase opacity-70",
        className
      )}
      {...props}
    />
  )
}

/**
 * Headline. Renders {typography.display-md} (32px / 400) — display type is
 * never bolder than 500 in this system.
 */
function SignatureCardTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="signature-card-title"
      className={cn(
        "font-display text-title-lg font-normal tracking-[-0.011em] text-balance text-current sm:text-display-md",
        className
      )}
      {...props}
    />
  )
}

/** Supporting copy in {typography.body-md} (14px / 400). */
function SignatureCardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="signature-card-description"
      className={cn("mt-md max-w-prose text-body-md opacity-85", className)}
      {...props}
    />
  )
}

/**
 * CTA row. Signature cards pair with `button-secondary-on-dark` — i.e.
 * <Button variant="on-dark"> on coral / forest / dark surfaces.
 */
function SignatureCardActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="signature-card-actions"
      className={cn("mt-lg flex flex-wrap items-center gap-sm", className)}
      {...props}
    />
  )
}

/**
 * Media well. Signature card images "compress to their card width without
 * cropping"; demo/product fragments crop into {rounded.md} containers.
 */
function SignatureCardMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="signature-card-media"
      className={cn(
        "mt-xl overflow-hidden rounded-md [&_img]:h-full [&_img]:w-full [&_img]:object-cover",
        className
      )}
      {...props}
    />
  )
}

export {
  SignatureCard,
  SignatureCardEyebrow,
  SignatureCardTitle,
  SignatureCardDescription,
  SignatureCardActions,
  SignatureCardMedia,
  signatureCardVariants,
}
