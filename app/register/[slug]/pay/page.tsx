import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CreditCardIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { ReservationCountdown } from "@/components/registration/reservation-countdown";
import { hasPassed } from "@/components/registration/deadline";
import { formatPrice } from "@/components/shared/currency";
import { getMunBySlug } from "@/lib/actions/marketplace";
import { getRegistrationById } from "@/lib/actions/registration";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { registrationProducts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { completeMockPaymentAction } from "../actions";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

interface PayPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ registrationId?: string; error?: string }>;
}

/**
 * Mock provider checkout.
 *
 * This stands in for the hosted Razorpay page. It exists because a
 * registration is only ever CONFIRMED by `POST /api/webhooks/payments` — the
 * frontend is never the payment authority (PRD §17/25). "Pay" here signs a
 * provider-shaped payload server-side and posts it to that same webhook, so
 * the confirmation path exercised in dev is the real one.
 */
export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { slug } = await params;
  const { registrationId, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/register/${slug}`)}`);
  }

  const mun = await getMunBySlug(slug);
  if (!mun) {
    notFound();
  }

  if (!registrationId) {
    redirect(`/register/${slug}`);
  }

  // getRegistrationById throws Forbidden for a non-owner. Caught here rather
  // than left to the route error boundary — Next.js redacts thrown error
  // messages in production, so error.tsx can never reliably distinguish
  // "Forbidden" from any other failure by `error.message`.
  let registration;
  try {
    registration = await getRegistrationById(registrationId);
  } catch {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xl sm:px-xl">
          <RegistrationNotice
            tone="error"
            title="You can't view this registration"
            message="This registration belongs to a different account. If it's yours, sign in with the email you used to register."
          >
            <Button render={<Link href="/login" />}>Sign in</Button>
            <Button variant="outline" render={<Link href="/muns" />}>
              Browse MUNs
            </Button>
          </RegistrationNotice>
        </main>
        <SiteFooter />
      </div>
    );
  }
  if (!registration) {
    notFound();
  }

  // Already resolved one way or the other — don't offer to "pay" again.
  if (registration.status !== "PAYMENT_PENDING" && registration.status !== "PENDING") {
    redirect(
      `/register/${slug}/confirmation?registrationId=${encodeURIComponent(registrationId)}`,
    );
  }

  const [product] = await db
    .select({
      name: registrationProducts.name,
      price: registrationProducts.price,
    })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, registration.registrationProductId))
    .limit(1);

  // Authoritative "has the 15-minute hold lapsed?" check. This runs on the
  // server; the client countdown only *displays* the same deadline and can
  // never be the thing that decides.
  const expired = hasPassed(registration.expiresAt);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        <header className="flex flex-col gap-xs">
          <p className="text-caption uppercase text-muted-foreground">Secure checkout</p>
          <h1 className="font-display text-display-md text-ink text-balance">
            Complete your payment
          </h1>
          <p className="text-body-md text-muted-foreground">
            {mun.name} · {product?.name ?? "Registration"}
          </p>
        </header>

        {expired ? (
          <RegistrationNotice
            tone="warning"
            title="Your seat hold expired"
            message="Reservations are held for 15 minutes. This one lapsed, so the seat went back into the pool and you were not charged. Start again to reserve a fresh seat."
          >
            <Button render={<Link href={`/register/${slug}`} />}>Start over</Button>
            <Button variant="outline" render={<Link href={`/mun/${slug}`} />}>
              Back to conference
            </Button>
          </RegistrationNotice>
        ) : (
          <>
            {error === "webhook" && (
              <RegistrationNotice
                tone="error"
                title="We couldn't reach the payment processor"
                message="Your seat is still held and you have not been charged. Try again — if it keeps failing, your reservation will expire on its own and free the seat."
              />
            )}

            {registration.expiresAt && (
              <ReservationCountdown expiresAt={registration.expiresAt.toISOString()} />
            )}

            <section className="flex flex-col gap-lg rounded-md border border-border p-lg sm:p-xl">
              <div className="flex items-baseline justify-between gap-md border-b border-border pb-md">
                <span className="text-label-md text-ink">Amount due</span>
                <span className="font-mono text-title-lg tabular-nums text-ink">
                  {formatPrice(product?.price ?? null)}
                </span>
              </div>

              <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
                <ShieldCheckIcon className="mt-px size-4 shrink-0" aria-hidden />
                <p>
                  <span className="font-medium text-ink">Mock provider.</span> No real card is
                  charged. Both buttons post a signed, provider-shaped webhook to the same
                  endpoint a live gateway would — confirmation still happens server-side.
                </p>
              </div>

              <div className="flex flex-col gap-sm sm:flex-row sm:items-center">
                <form action={completeMockPaymentAction} className="contents">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="registrationId" value={registration.id} />
                  <input type="hidden" name="outcome" value="success" />
                  <Button type="submit" size="lg" className="sm:flex-1">
                    <CreditCardIcon aria-hidden />
                    Pay {formatPrice(product?.price ?? null)}
                  </Button>
                </form>

                <form action={completeMockPaymentAction} className="contents">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="registrationId" value={registration.id} />
                  <input type="hidden" name="outcome" value="failure" />
                  <Button type="submit" size="lg" variant="outline">
                    Simulate failure
                  </Button>
                </form>
              </div>

              <p className="flex items-center gap-xs text-body-md text-muted-foreground">
                <LockIcon className="size-3.5" aria-hidden />
                Reference{" "}
                <code className="font-mono text-[13px] text-ink">{registration.id}</code>
              </p>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
