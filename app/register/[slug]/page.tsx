import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CalendarIcon, MapPinIcon } from "lucide-react";
import { cn } from "cn";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationForm } from "@/components/registration/registration-form";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { hasPassed } from "@/components/registration/deadline";
import { formatDateRange } from "@/components/shared/date-range";
import { getMunBySlug } from "@/lib/actions/marketplace";
import { getProductsAvailability } from "@/lib/actions/registration";
import { listAccommodationOptions } from "@/lib/actions/accommodation";
import { isSelectableOption } from "@/components/registration/accommodation-fields";
import { getSession } from "@/app/lib/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface RegisterPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ product?: string }>;
}

export async function generateMetadata({ params }: RegisterPageProps): Promise<Metadata> {
  const { slug } = await params;
  const mun = await getMunBySlug(slug);
  if (!mun) return {};

  return {
    title: `Register — ${mun.name}`,
    description: `Reserve your delegate seat at ${mun.name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function RegisterPage({ params, searchParams }: RegisterPageProps) {
  const { slug } = await params;
  const { product: preselectedProductId } = await searchParams;

  const mun = await getMunBySlug(slug);
  if (!mun) {
    notFound();
  }

  // Auth gate. `initiateRegistration` throws Forbidden without a session, so
  // bounce to sign-in *before* rendering a form the user can't submit.
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/register/${slug}`)}`);
  }

  const dateRange = formatDateRange(mun.startDate, mun.endDate);
  const location = [mun.city, mun.country].filter(Boolean).join(", ");

  // ---- Closed-for-registration state -------------------------------------
  if (mun.status !== "REGISTRATION_OPEN") {
    return (
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
        <RegistrationNotice
          tone="neutral"
          title="Registration isn't open"
          message={
            mun.status === "REGISTRATION_CLOSED"
              ? `Registration for ${mun.name} has closed. Watch the conference page for waitlist or late-registration announcements.`
              : `${mun.name} hasn't opened registration yet. Check the conference page for the announcement date.`
          }
        >
          <Button render={<Link href={`/mun/${slug}`} />}>View conference</Button>
          <Button variant="outline" render={<Link href="/muns" />}>
            Browse other MUNs
          </Button>
        </RegistrationNotice>
      </RegistrationShell>
    );
  }

  // ---- Live seat counts ---------------------------------------------------
  // getProductsAvailability also sweeps expired reservations, so these counts
  // reflect seats actually held right now, not stale PENDING rows. Batched
  // into one call instead of one getProductAvailability round-trip per
  // product — same fix as app/mun/[slug]/page.tsx.
  const availabilityByProduct = new Map(
    await getProductsAvailability(mun.registrationProducts.map((product) => product.id)),
  );
  const availability = mun.registrationProducts.map((product) => ({
    product,
    ...(availabilityByProduct.get(product.id) ?? { capacity: product.capacity, taken: 0, available: product.capacity }),
    // Resolved here, on the server, so the client never has to call
    // Date.now() during render (impure => hydration mismatch).
    deadlinePassed: hasPassed(product.deadline),
  }));

  if (availability.length === 0) {
    return (
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
        <RegistrationNotice
          tone="neutral"
          title="No registration options yet"
          message={`${mun.name} is open but hasn't published any registration passes. Check back shortly.`}
        >
          <Button render={<Link href={`/mun/${slug}`} />}>View conference</Button>
        </RegistrationNotice>
      </RegistrationShell>
    );
  }

  // ---- Fully sold out -----------------------------------------------------
  const anySeatsLeft = availability.some((entry) => entry.available > 0);
  if (!anySeatsLeft) {
    return (
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
        <RegistrationNotice
          tone="warning"
          title="Every pass is sold out"
          message={`All ${availability.reduce((sum, e) => sum + e.capacity, 0)} seats for ${mun.name} are taken. Seats occasionally free up when a reservation expires — it's worth checking back.`}
        >
          <Button render={<Link href={`/mun/${slug}`} />}>View conference</Button>
          <Button variant="outline" render={<Link href="/muns" />}>
            Browse other MUNs
          </Button>
        </RegistrationNotice>
      </RegistrationShell>
    );
  }

  // Accommodation is optional inventory — a MUN with none simply doesn't get
  // the step. Resolved server-side like everything else this page hands the
  // form; `listAccommodationOptions` returns soft-deleted ('inactive') rows
  // too, so filter before they can ever be rendered as selectable.
  const accommodationOptions = (await listAccommodationOptions(mun.id)).filter(
    isSelectableOption,
  );

  const [profile] = await db
    .select({
      name: users.name,
      email: users.email,
      phone: users.phone,
      institution: users.institution,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return (
    <RegistrationShell munName={mun.name} dateRange={dateRange} location={location}>
      <RegistrationForm
        slug={slug}
        munName={mun.name}
        products={availability}
        committees={mun.committees}
        accommodationOptions={accommodationOptions}
        // Deep link from the MUN page's pricing cards
        // (`/register/[slug]?product=<id>`). Validated against this MUN's own
        // products so a stray id can't preselect foreign inventory.
        preselectedProductId={
          availability.some((entry) => entry.product.id === preselectedProductId)
            ? preselectedProductId
            : undefined
        }
        defaults={{
          fullName: profile?.name ?? "",
          email: profile?.email ?? "",
          phone: profile?.phone ?? "",
          institution: profile?.institution ?? "",
        }}
      />
    </RegistrationShell>
  );
}

/**
 * Shared chrome for every branch of this route. Calm white canvas, a compact
 * conference header, then the transactional body — no signature marketing
 * bands: this is a checkout utility surface, not an editorial one.
 */
function RegistrationShell({
  munName,
  dateRange,
  location,
  narrow = false,
  children,
}: {
  munName: string;
  dateRange: string;
  location: string;
  /**
   * Terminal states (closed / sold out) carry one short panel instead of the
   * full two-column form, so they use a tighter column — otherwise the panel
   * strands a wide band of empty canvas beside it.
   */
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-xl sm:px-xl",
          // Terminal panels are short, so center them in the remaining height
          // rather than leaving a long dead gap above the footer.
          narrow ? "max-w-2xl justify-center" : "max-w-5xl",
        )}
      >
        <header className="flex flex-col gap-xs border-b border-border pb-lg">
          <p className="text-caption uppercase text-muted-foreground">Registration</p>
          <h1 className="font-display text-display-md text-ink text-balance">{munName}</h1>
          <div className="flex flex-wrap items-center gap-md text-body-md text-muted-foreground">
            <span className="inline-flex items-center gap-xs">
              <CalendarIcon className="size-4" aria-hidden />
              {dateRange}
            </span>
            {location && (
              <span className="inline-flex items-center gap-xs">
                <MapPinIcon className="size-4" aria-hidden />
                {location}
              </span>
            )}
          </div>
        </header>

        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
