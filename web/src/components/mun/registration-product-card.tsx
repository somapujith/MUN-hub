import { Link } from "react-router";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/components/shared/currency";
import { currentPassPrice, formatPriceDeadline } from "@/components/registration/pricing";
import { cn } from "cn";
import type { RegistrationProduct } from "@/types";

/**
 * Registration pass — `pricing-tier-card` (docs/prd/DESIGN-airtable.md § Pricing
 * Sub-System): canvas background, {rounded.md} (10px), 32px internal padding,
 * price in {typography.pricing-display} (44.8px / 475), a short feature list,
 * and a {component.button-pricing-pill} at the bottom.
 *
 * This is the one surface on the page that speaks the pricing dialect — Inter
 * Display mid-weights + pill radius. The doc requires those tokens travel
 * together ("keep pricing-display, pricing-card-title, and button-pricing-pill
 * together"), and requires pill radius appear nowhere else.
 */

/** Seat availability, as returned by `getProductAvailability`. */
export interface ProductAvailability {
  capacity: number;
  taken: number;
  available: number;
}

interface RegistrationProductCardProps {
  product: RegistrationProduct;
  /** Live seat counts; omitted when availability couldn't be resolved. */
  availability?: ProductAvailability;
  /** Whether the MUN is currently accepting registrations. */
  canRegister: boolean;
  /** MUN slug, used to build the registration link. */
  munSlug: string;
  /** Renders on the `surface-soft` tone — the doc's only "featured" signal. */
  featured?: boolean;
}

export function RegistrationProductCard({
  product,
  availability,
  canRegister,
  munSlug,
  featured = false,
}: RegistrationProductCardProps) {
  const soldOut = availability !== undefined && availability.available === 0;
  const deadlinePassed = product.deadline !== null && product.deadline.getTime() < Date.now();
  const purchasable = canRegister && !soldOut && !deadlinePassed;
  const pricing = currentPassPrice(product);

  return (
    <div
      className={cn(
        // h-full + mt-auto on the CTA row keeps buttons aligned across cards
        // whose feature lists differ in length.
        "flex h-full flex-col rounded-md border p-xl",
        // pricing-tier-card-featured: the background tone shift is the ONLY
        // featured signal — no accent border, no badge (doc § Pricing).
        featured ? "border-transparent bg-surface-soft" : "border-border bg-card",
      )}
    >
      <h3 className="font-pricing text-pricing-card-title text-pricing-ink">{product.name}</h3>

      <p className="mt-md flex flex-wrap items-baseline gap-x-xs">
        <span className="font-pricing text-pricing-display text-pricing-ink tabular-nums">
          {formatPrice(pricing.price)}
        </span>
        {pricing.earlyBird && (
          <del className="text-body-md tabular-nums text-muted-foreground">
            <span className="sr-only">Regular price </span>
            {formatPrice(pricing.regularPrice)}
          </del>
        )}
        <span className="text-body-md text-muted-foreground">per delegate</span>
      </p>

      <ul className="mt-lg flex list-none flex-col gap-xs p-0 text-body-md text-body">
        {pricing.earlyBird && pricing.earlyBirdEndsAt && (
          <Feature>
            <span className="font-medium text-success-text">
              Early-bird price until {formatPriceDeadline(pricing.earlyBirdEndsAt)}
            </span>
          </Feature>
        )}

        <Feature>
          {availability
            ? soldOut
              ? "All seats taken"
              : `${availability.available} of ${availability.capacity} seats available`
            : `${product.capacity} seats total`}
        </Feature>

        {product.deadline && (
          <Feature>
            {deadlinePassed ? "Deadline passed" : `Closes ${formatDeadline(product.deadline)}`}
          </Feature>
        )}

        <Feature>Confirmed on payment</Feature>
      </ul>

      {/* Seat-pressure meter: a hairline track, not a decorative progress bar.
          Only shown once the pass is genuinely filling up — at 1% taken the bar
          renders as an empty track that reads as a broken element, and it
          communicates nothing a delegate can act on. Below the threshold the
          plain seat count in the feature list already carries the information. */}
      {availability && availability.capacity > 0 && fillRatio(availability) >= 0.5 && (
        <div className="mt-lg">
          <div
            className="h-1 w-full overflow-hidden rounded-pill bg-surface-strong"
            role="img"
            aria-label={`${availability.taken} of ${availability.capacity} seats taken`}
          >
            <div
              className="h-full rounded-pill bg-pricing-ink"
              // Floor the visible fill so a non-zero value never renders as an
              // apparently empty track.
              style={{ width: `${Math.min(100, Math.max(2, fillRatio(availability) * 100))}%` }}
            />
          </div>
          <p className="mt-xs text-caption text-muted-foreground tabular-nums">
            {Math.round(fillRatio(availability) * 100)}% of seats taken
          </p>
        </div>
      )}

      <div className="mt-auto pt-xl">
        {purchasable ? (
          <Button
            variant="pricing-solid"
            className="w-full"
            render={<Link to={`/register/${munSlug}?product=${product.id}`} />}
          >
            Select {product.name}
          </Button>
        ) : (
          <Button
            variant="pricing"
            disabled
            // Informational disabled state — keep full opacity so the label
            // stays readable; the hairline carries the unavailable signal.
            className="w-full disabled:opacity-100 disabled:border-border-strong disabled:text-muted-foreground"
          >
            {soldOut ? "Sold out" : deadlinePassed ? "Closed" : "Not yet open"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-xs">
      <CheckIcon
        className="mt-0.5 size-4 shrink-0 text-success-text"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

/** Share of capacity already taken, clamped to 0–1. */
function fillRatio(availability: ProductAvailability): number {
  if (availability.capacity <= 0) return 0;
  return Math.min(1, Math.max(0, availability.taken / availability.capacity));
}

function formatDeadline(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
