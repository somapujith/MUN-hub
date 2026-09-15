import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { formatDateRange } from "@/components/shared/date-range";
import { formatPrice } from "@/components/shared/currency";
import { getMunBySlug } from "@/lib/actions/marketplace";
import { getRegistrationById } from "@/lib/actions/registration";
import { getSession } from "@/app/lib/session";
import { db } from "@/lib/db/client";
import { committees, portfolios, registrationProducts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { RegistrationStatus } from "@/lib/types";

export const metadata: Metadata = {
  title: "Registration status",
  robots: { index: false, follow: false },
};

interface ConfirmationPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ registrationId?: string }>;
}

/**
 * Terminal state for the registration funnel.
 *
 * The status shown here is read back from the database via
 * `getRegistrationById` — it is never derived from "the form submitted
 * successfully". A registration reaches CONFIRMED only when the payments
 * webhook says so, so this page is the first honest answer the user gets.
 */
export default async function ConfirmationPage({
  params,
  searchParams,
}: ConfirmationPageProps) {
  const { slug } = await params;
  const { registrationId } = await searchParams;

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

  // getRegistrationById throws Forbidden for a non-owner. That must be caught
  // here, server-side — Next.js redacts thrown error messages before they
  // reach a client error boundary in production, so an error.tsx that tries
  // to distinguish "Forbidden" from any other failure by `error.message` is
  // dead code in prod (only `error.digest` survives). Render the forbidden
  // state directly instead of letting the throw propagate.
  let registration;
  try {
    registration = await getRegistrationById(registrationId, session);
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

  const [product] = await db
    .select({ name: registrationProducts.name, price: registrationProducts.price })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, registration.registrationProductId))
    .limit(1);

  const [committee] = registration.committeeId
    ? await db
        .select({ name: committees.name })
        .from(committees)
        .where(eq(committees.id, registration.committeeId))
        .limit(1)
    : [];

  const [portfolio] = registration.portfolioId
    ? await db
        .select({ name: portfolios.name })
        .from(portfolios)
        .where(eq(portfolios.id, registration.portfolioId))
        .limit(1)
    : [];

  const receipt = (
    <dl className="divide-y divide-border rounded-md border border-border bg-card">
      <ReceiptRow label="Reference" value={registration.id} mono />
      <ReceiptRow label="Conference" value={mun.name} />
      <ReceiptRow label="Dates" value={formatDateRange(mun.startDate, mun.endDate)} />
      <ReceiptRow label="Pass" value={product?.name ?? "Registration"} />
      {committee && <ReceiptRow label="Committee" value={committee.name} />}
      {portfolio && <ReceiptRow label="Portfolio" value={portfolio.name} />}
      <ReceiptRow label="Amount" value={formatPrice(product?.price ?? null)} mono />
      <ReceiptRow label="Status" value={STATUS_LABEL[registration.status]} />
    </dl>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      {/* `justify-center` keeps the terminal panel optically centered in the
          viewport instead of stranding it under the header with a long dead
          gap before the footer. */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl">
        {renderStatus(registration.status, slug, receipt, registrationId)}
      </main>
      <SiteFooter />
    </div>
  );
}

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: "Awaiting payment",
  PAYMENT_PENDING: "Payment in progress",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  ATTENDED: "Attended",
  NO_SHOW: "Marked as no-show",
};

function renderStatus(
  status: RegistrationStatus,
  slug: string,
  receipt: React.ReactNode,
  registrationId: string,
) {
  switch (status) {
    case "CONFIRMED":
      return (
        <RegistrationNotice
          tone="success"
          title="You're registered"
          message="Payment went through and your seat is confirmed. The organizing team has your delegate details — keep the reference below for any correspondence."
          detail={receipt}
        >
          <Button render={<Link href={`/mun/${slug}`} />}>Back to conference</Button>
          <Button variant="outline" render={<Link href="/muns" />}>
            Browse more MUNs
          </Button>
        </RegistrationNotice>
      );

    case "CANCELLED":
      // The webhook sets CANCELLED on a failed payment (releasing the seat) and
      // the lazy sweep sets it on an expired hold. Either way: no charge, seat
      // is back in the pool, retry is the right affordance.
      return (
        <RegistrationNotice
          tone="error"
          title="Payment didn't go through"
          message="Your seat has been released back to the pool and you have not been charged. You can try again — seats are first come, first served, so it's worth doing now."
          detail={receipt}
        >
          <Button render={<Link href={`/register/${slug}`} />}>Try again</Button>
          <Button variant="outline" render={<Link href={`/mun/${slug}`} />}>
            Back to conference
          </Button>
        </RegistrationNotice>
      );

    case "PAYMENT_PENDING":
    case "PENDING":
      return (
        <RegistrationNotice
          tone="warning"
          title="Payment still processing"
          message="We're waiting for the payment provider to confirm. This usually resolves in a few seconds. Your seat stays held in the meantime — refresh to check again."
          detail={receipt}
        >
          <Button
            render={
              <Link
                href={`/register/${slug}/confirmation?registrationId=${encodeURIComponent(registrationId)}`}
              />
            }
          >
            Refresh status
          </Button>
          <Button
            variant="outline"
            render={
              <Link
                href={`/register/${slug}/pay?registrationId=${encodeURIComponent(registrationId)}`}
              />
            }
          >
            Return to checkout
          </Button>
        </RegistrationNotice>
      );

    case "REFUNDED":
      return (
        <RegistrationNotice
          tone="neutral"
          title="This registration was refunded"
          message="Your payment has been returned and the seat released. Contact the organizing team if this looks wrong."
          detail={receipt}
        >
          <Button render={<Link href={`/mun/${slug}`} />}>Back to conference</Button>
        </RegistrationNotice>
      );

    // Post-conference states set by organizers during/after the event. A user
    // can still land here from an old link, so they get a sane read-only view
    // rather than falling through to a blank page.
    case "ATTENDED":
      return (
        <RegistrationNotice
          tone="success"
          title="You attended this conference"
          message="Your registration is complete and the organizing team marked you as attended."
          detail={receipt}
        >
          <Button render={<Link href={`/mun/${slug}`} />}>Back to conference</Button>
        </RegistrationNotice>
      );

    case "NO_SHOW":
      return (
        <RegistrationNotice
          tone="neutral"
          title="Marked as a no-show"
          message="The organizing team recorded this registration as a no-show. Contact them directly if that's a mistake."
          detail={receipt}
        >
          <Button render={<Link href={`/mun/${slug}`} />}>Back to conference</Button>
        </RegistrationNotice>
      );
  }
}

function ReceiptRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-md px-md py-sm">
      <dt className="text-body-md text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "text-right font-mono text-[13px] tabular-nums text-ink"
            : "text-right text-body-md text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}
