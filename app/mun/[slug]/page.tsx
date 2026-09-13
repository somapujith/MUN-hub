import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunHero } from "@/components/mun/mun-hero";
import { CommitteeList } from "@/components/mun/committee-list";
import {
  RegistrationProductCard,
  type ProductAvailability,
} from "@/components/mun/registration-product-card";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardEyebrow,
  SignatureCardTitle,
  SignatureCardDescription,
} from "@/components/ui/signature-card";
import { cache } from "react";
import { getMunBySlug } from "@/lib/actions/marketplace";
import { getProductsAvailability } from "@/lib/actions/registration";
import { cn } from "cn";
import type { RegistrationProduct } from "@/lib/types";

interface MunDetailPageProps {
  params: Promise<{ slug: string }>;
}

// generateMetadata and the page body both need the same mun — cache()
// collapses them into one DB call per request instead of two.
const loadMun = cache(getMunBySlug);

export async function generateMetadata({ params }: MunDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const mun = await loadMun(slug);
  if (!mun) return {};

  return {
    title: mun.name,
    description: mun.description ?? `${mun.name} — register on MUN Hub.`,
  };
}

/**
 * Resolves live seat counts for all products in one batched call.
 * Availability is a best-effort enhancement on a public listing page: if the
 * lookup fails (DB hiccup), cards fall back to showing plain capacity
 * rather than failing the whole page render.
 */
async function resolveAvailability(
  products: RegistrationProduct[],
): Promise<Map<string, ProductAvailability>> {
  if (products.length === 0) {
    return new Map();
  }

  try {
    const entries = await getProductsAvailability(products.map((product) => product.id));
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export default async function MunDetailPage({ params }: MunDetailPageProps) {
  const { slug } = await params;
  const mun = await loadMun(slug);

  if (!mun) {
    notFound();
  }

  const canRegister = mun.status === "REGISTRATION_OPEN";
  const products = mun.registrationProducts;
  const availability = await resolveAvailability(products);

  const prices = products.map((product) => product.price);
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;

  // Featured tier = the cheapest entry point, the pass most delegates want.
  const featuredProductId =
    products.length > 1
      ? products.reduce((cheapest, product) =>
          product.price < cheapest.price ? product : cheapest,
        ).id
      : null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        {/* Band 1 — white canvas hero */}
        <MunHero mun={mun} fromPrice={fromPrice} />

        {/* Band 2 — white canvas: about + committees */}
        <section className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
          {mun.description && (
            <div className="max-w-3xl">
              <h2 className="font-display text-title-lg font-normal text-ink md:text-display-md">
                About this conference
              </h2>
              <p className="mt-md text-title-md leading-relaxed font-normal text-body">
                {mun.description}
              </p>
            </div>
          )}

          <div className={mun.description ? "mt-xxl" : undefined}>
            <div className="flex flex-wrap items-baseline justify-between gap-sm">
              <h2 className="font-display text-title-lg font-normal text-ink md:text-display-md">
                Committees
              </h2>
              {mun.committees.length > 0 && (
                <p className="text-body-md text-muted-foreground tabular-nums">
                  {mun.committees.length}{" "}
                  {mun.committees.length === 1 ? "committee" : "committees"} ·{" "}
                  {mun.committees.reduce((sum, c) => sum + c.portfolios.length, 0)} portfolios
                </p>
              )}
            </div>

            <div className="mt-lg">
              <CommitteeList committees={mun.committees} />
            </div>
          </div>
        </section>

        {/* Band 3 — cream callout: the organizer moment. Breaks the white
            monotony without turning a listing page into a marketing page. */}
        <section className="content-container pb-xxl md:pb-section">
          <SignatureCard variant="cream" padding="xl">
            <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <SignatureCardEyebrow>About the organizer</SignatureCardEyebrow>
                <SignatureCardTitle>
                  {mun.organizerName ?? "Independent organizer"}
                </SignatureCardTitle>
                <SignatureCardDescription className="text-[#333840] opacity-100">
                  Every conference on MUN Hub is reviewed and verified before it goes live —
                  organizer identity, venue details, and registration terms are checked by our
                  team, so delegates register with confidence.
                </SignatureCardDescription>
              </div>

              <div className="flex flex-wrap gap-sm lg:justify-end">
                <Button variant="on-dark" render={<Link href="/muns" />}>
                  Browse all conferences
                </Button>
              </div>
            </div>
          </SignatureCard>
        </section>

        {/* Band 4 — surface-soft: the pricing sub-system surface. Giving the
            pricing dialect its own tinted band keeps it visibly separate from
            the editorial body above it. */}
        <section id="registration" className="scroll-mt-xl bg-surface-soft">
          <div className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
            <div className="max-w-3xl">
              <h2 className="font-pricing text-pricing-section text-pricing-ink">
                Registration passes
              </h2>
              <p className="mt-sm text-body-md text-muted-foreground">
                {canRegister
                  ? "Choose a pass to begin registration. Seats are held briefly while you complete payment."
                  : "Registration isn't open for this conference right now. Passes are shown for reference."}
              </p>
            </div>

            {products.length === 0 ? (
              <div className="mt-lg rounded-md border border-dashed border-border-strong bg-card px-lg py-xl">
                <p className="text-body-md text-muted-foreground">
                  No registration passes have been published for this conference yet.
                </p>
              </div>
            ) : (
              <div
                className={cn(
                  "mt-xl grid grid-cols-1 gap-lg sm:grid-cols-2",
                  // Cap the track count at the number of passes so a 2-pass MUN
                  // doesn't strand an empty third column, and keep the row from
                  // stretching cards to full width when there's only one.
                  products.length >= 3 && "lg:grid-cols-3",
                  products.length === 1 && "sm:grid-cols-1 sm:max-w-sm",
                )}
              >
                {products.map((product) => (
                  <RegistrationProductCard
                    key={product.id}
                    product={product}
                    availability={availability.get(product.id)}
                    canRegister={canRegister}
                    munSlug={mun.slug}
                    featured={product.id === featuredProductId}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
