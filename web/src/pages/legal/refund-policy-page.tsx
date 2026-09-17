import { Link } from "react-router";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { SITE_INFO, mailto } from "@/lib/site-info";

const SECTIONS: LegalSection[] = [
  {
    id: "all-payments-final",
    title: "All payments are final",
    body: (
      <>
        <p>
          <strong>
            Once your payment is verified and your registration is confirmed,
            the amount you paid is not refundable, in whole or in part.
          </strong>{" "}
          This applies to every conference on MUN Hub, whatever a
          conference's own materials say, including when:
        </p>
        <ul>
          <li>you cancel, change your mind, or can no longer attend</li>
          <li>you don't show up, or leave the conference early</li>
          <li>
            you're removed from the conference for breaking its rules or our{" "}
            <Link to="/legal/terms">Terms of service</Link>
          </li>
          <li>
            the organizer changes the dates, venue, schedule, committees, or
            your committee or portfolio allocation
          </li>
          <li>the conference is postponed or cancelled</li>
          <li>we suspend or remove the conference's listing</li>
        </ul>
        <p>
          Registrations belong to the delegate who registered and can't be
          transferred through MUN Hub. Ask the organizer whether they accept a
          substitute delegate.
        </p>
      </>
    ),
  },
  {
    id: "before-you-pay",
    title: "Before you pay",
    body: (
      <>
        <p>Because every payment is final, please check before you pay:</p>
        <ul>
          <li>the conference dates, venue, and city</li>
          <li>which pass you're buying, what it includes, and whether you meet its eligibility rules</li>
          <li>that you can attend</li>
        </ul>
        <p>
          If anything is unclear, <Link to="/contact">ask us</Link> before
          registering. When you start a registration, we hold your seat for 15
          minutes while you pay. Your registration is confirmed only once
          we've verified the payment.
        </p>
      </>
    ),
  },
  {
    id: "failed-and-late-payments",
    title: "The one exception: payment errors",
    body: (
      <>
        <p>
          If money is taken from you without a valid registration behind it,
          we return it. That isn't a refund of a registration, because no
          registration was created. It covers these cases:
        </p>
        <ul>
          <li>
            <strong>Your payment completed after your seat hold expired.</strong>{" "}
            The registration isn't confirmed, because the seat may already have
            gone to someone else, so we return the full amount.
          </li>
          <li>
            <strong>You were charged more than once</strong> for the same
            registration. We return the extra charges.
          </li>
          <li>
            <strong>A technical error on our side</strong> took your money
            without creating a registration. We return the full amount.
          </li>
          <li>
            <strong>Your payment failed, but money was deducted anyway.</strong>{" "}
            Your bank or payment provider usually reverses this automatically
            within 5 to 7 working days. If it doesn't, contact us.
          </li>
        </ul>
        <p>
          We start these returns ourselves as soon as we've confirmed the
          error. The money goes back to the original payment method, and your
          bank or payment provider usually takes 5 to 10 working days to show
          it.
        </p>
      </>
    ),
  },
  {
    id: "platform-fee",
    title: "Our platform fee",
    body: (
      <>
        <p>
          MUN Hub charges a platform fee on every paid registration. It pays
          for the service we provide and for making MUN Hub better for
          everyone who uses it:
        </p>
        <ul>
          <li>reviewing every organizer and listing before it goes live</li>
          <li>secure payment processing and payment verification</li>
          <li>registration and delegate-management tools for organizers</li>
          <li>support for delegates and organizers</li>
          <li>continued improvements to the platform</li>
        </ul>
        <p>
          The platform fee is included in the price shown on the listing, and
          applicable taxes such as GST apply to it. We deduct it from the
          registration fee before the organizer is paid.
        </p>
        <p>
          Like the rest of your payment, the platform fee isn't refundable. The
          only exception is a payment error under section 3, where we return
          the full amount.
        </p>
      </>
    ),
  },
  {
    id: "requesting",
    title: "Reporting a payment problem",
    body: (
      <ol>
        <li>
          Sign in and <Link to="/support/new">open a support ticket</Link>,
          choosing the “Payment” category. You can also email{" "}
          <a href={mailto(SITE_INFO.emails.support)}>{SITE_INFO.emails.support}</a>{" "}
          from the address on your account.
        </li>
        <li>
          Include the conference name, when you paid, and the transaction
          reference from your bank or payment app.
        </li>
        <li>
          We check the payment records and email you what we found. If it's a
          payment error under section 3, we return the money as described
          there.
        </li>
      </ol>
    ),
  },
  {
    id: "disputes",
    title: "Payment disputes",
    body: (
      <p>
        If you dispute a confirmed payment with your bank or card issuer, we
        may share your registration and payment records with them to show the
        payment was valid. Please contact us first. We can often resolve a
        problem faster than a bank dispute can.
      </p>
    ),
  },
  {
    id: "organizers",
    title: "For organizers",
    body: (
      <ul>
        <li>
          Registrations on MUN Hub are final. Don't promise delegates refunds,
          in your listing or anywhere else, for payments made through MUN Hub.
        </li>
        <li>
          Your payouts are the registration fees you collect, minus MUN Hub's
          platform fee and applicable taxes, at the rate we agree with you
          before your conference is published.
        </li>
        <li>
          If you change or cancel your conference, tell registered delegates
          straight away. Cancelling a conference or materially changing it can
          lead us to suspend your listing or take other action under our{" "}
          <Link to="/legal/terms#organizers">Terms of service</Link>.
        </li>
        <li>
          We may set off payment errors, chargebacks, and amounts paid out in
          error against your payouts.
        </li>
      </ul>
    ),
  },
  {
    id: "contact",
    title: "Questions",
    body: (
      <p>
        Questions about a payment? Ask us at{" "}
        <a href={mailto(SITE_INFO.emails.support)}>{SITE_INFO.emails.support}</a>{" "}
        or through our <Link to="/contact">Contact page</Link>. This policy
        doesn't affect any rights you have by law that can't be excluded.
      </p>
    ),
  },
];

export function RefundPolicyPage() {
  return (
    <LegalDocument
      href="/legal/refunds"
      title="Refund policy"
      description="All payments on MUN Hub are final. No refunds once a registration is paid, apart from payment errors. Also explains MUN Hub's platform fee."
      lede="All payments on MUN Hub are final. This page explains what that covers, the one exception for payment errors, and our platform fee."
      summary={[
        "Once a registration is paid and confirmed, there are no refunds.",
        "That applies whatever happens: if you cancel, don't attend, or the conference is changed, postponed, or cancelled.",
        "The only exception is a payment error, such as a double charge or a payment that didn't create a registration. We return that money.",
        "Every registration includes MUN Hub's platform fee, which pays for our service. It isn't refundable either.",
        "Check the conference details carefully before you pay.",
      ]}
      sections={SECTIONS}
    />
  );
}
