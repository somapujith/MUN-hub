import { Link } from "react-router";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { SITE_INFO, mailto } from "@/lib/site-info";

const SECTIONS: LegalSection[] = [
  {
    id: "about-these-terms",
    title: "About these terms",
    body: (
      <>
        <p>
          These terms are an agreement between you and {SITE_INFO.name} (“MUN
          Hub”, “we”, “us”) covering your use of {SITE_INFO.domain}, its
          subdomains, and the services we provide there (together, the
          “Platform”).
        </p>
        <p>
          By creating an account, registering for a conference, or listing a
          conference, you agree to these terms, our{" "}
          <Link to="/legal/privacy">Privacy policy</Link>, and our{" "}
          <Link to="/legal/refunds">Refund policy</Link>. If you don't agree,
          please don't use the Platform.
        </p>
        <p>
          If you use the Platform on behalf of a school, college, club, or
          other organization, you confirm that you're authorized to accept
          these terms for it.
        </p>
      </>
    ),
  },
  {
    id: "what-we-do",
    title: "What MUN Hub does, and doesn't do",
    body: (
      <>
        <p>
          MUN Hub is a curated marketplace for Model United Nations
          conferences. We help delegates discover and register for
          conferences, help organizers run registration, and review every
          listing before it's published, as described in our{" "}
          <Link to="/about/curation">Curation standards</Link>.
        </p>
        <p>
          <strong>We don't organize or run the conferences we list.</strong>{" "}
          Each conference is run by its organizer, who is responsible for
          delivering it as described: its committees, agendas, venue,
          schedule, conduct, safety, and awards. Your registration for a
          conference is an arrangement between you and that organizer. We
          provide the platform for it, collect registration fees on the
          organizer's behalf, and keep a platform fee for our service.
        </p>
        <p>
          Our review means the organizer was approved and the listing's
          details were checked when we reviewed them. It doesn't rate the
          quality of a conference, and it doesn't guarantee that an organizer
          will deliver the conference as listed.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Eligibility and your account",
    body: (
      <>
        <ul>
          <li>
            <strong>Delegates under 18</strong> may use MUN Hub only with the
            knowledge and consent of a parent or legal guardian. We ask for
            that acknowledgement when a minor signs up, and the parent or
            guardian accepts these terms on the minor's behalf.
          </li>
          <li>
            <strong>Give accurate information</strong> and keep it up to date.
            Organizers rely on your profile to run their conferences, and
            emergency contact details must be real.
          </li>
          <li>
            <strong>One person, one account.</strong> Don't create accounts
            for other people or share yours.
          </li>
          <li>
            <strong>Keep your password safe.</strong> You're responsible for
            activity on your account. Tell us straight away at{" "}
            <a href={mailto(SITE_INFO.emails.support)}>{SITE_INFO.emails.support}</a>{" "}
            if you think someone else has accessed it.
          </li>
          <li>
            <strong>Delegate and organizer accounts are separate.</strong>{" "}
            Organizers create their account through organizer sign-up and
            can't publish anything until we approve their application. A
            delegate account can't be turned into an organizer account.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "registering",
    title: "Registering for a conference",
    body: (
      <>
        <ul>
          <li>
            When you start a registration, we <strong>hold your seat for 15
            minutes</strong> while you pay. If payment isn't completed in that
            time, the hold is released and the seat goes back on sale.
          </li>
          <li>
            <strong>Your registration is confirmed only after we verify your
            payment</strong> on our servers. A success message in your browser
            or payment app doesn't confirm a registration on its own.
          </li>
          <li>
            You can hold only one active registration per pass. We block
            duplicate registrations so you aren't charged twice.
          </li>
          <li>
            Organizers may set eligibility rules for a pass (for example,
            school delegates only) and may ask their own registration
            questions. Answer them accurately. An organizer may cancel a
            registration that doesn't meet its published requirements. As
            with every registration, the payment isn't refundable (see the{" "}
            <Link to="/legal/refunds">Refund policy</Link>).
          </li>
          <li>
            When you register, we share your registration details with that
            conference's organizer so they can run it. The{" "}
            <Link to="/legal/privacy">Privacy policy</Link> explains exactly
            what they receive.
          </li>
          <li>
            Committee and portfolio allocations are made by the organizer and
            aren't guaranteed unless the listing says otherwise.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "payments",
    title: "Fees and payments",
    body: (
      <>
        <ul>
          <li>
            Prices are set by organizers and shown on each listing in the
            currency stated there, including any applicable taxes unless we
            say otherwise.
          </li>
          <li>
            Every registration includes MUN Hub's <strong>platform fee</strong>,
            which pays for our service: listing review, secure payments,
            registration tools, and support. Applicable taxes apply to it, and
            it's non-refundable.
          </li>
          <li>
            <strong>All payments are final.</strong> Once a registration is
            paid and confirmed, there are no refunds.
          </li>
          <li>
            Payments are handled by our payment gateway partner. We don't
            receive or store your full card number, UPI PIN, or banking
            passwords.
          </li>
          <li>
            The price you pay is the price calculated by our servers when you
            register. A price changed or shown incorrectly in your browser
            doesn't bind us or the organizer.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "no-refunds",
    title: "No refunds",
    body: (
      <p>
        Payments for confirmed registrations are not refundable under any
        circumstances. This includes when you cancel or don't attend, and
        when a conference is changed, postponed, or cancelled. The only
        exception is a payment error, such as a double charge or a payment
        that didn't create a registration. Our{" "}
        <Link to="/legal/refunds">Refund policy</Link> sets out the details and
        forms part of these terms.
      </p>
    ),
  },
  {
    id: "organizers",
    title: "Additional terms for organizers",
    body: (
      <>
        <p>If you list a conference on MUN Hub, you also agree to the following.</p>
        <ul>
          <li>
            <strong>Approval and review.</strong> Your organization must be
            approved before you can build a listing, and every listing must
            pass our review before it's published. We may request changes,
            reject, suspend, or remove a listing as described in our{" "}
            <Link to="/about/curation">Curation standards</Link>, which form
            part of these terms.
          </li>
          <li>
            <strong>Accuracy and accountability.</strong> You confirm that
            everything you submit is accurate, complete, and authorized for
            publication, and you remain responsible for it. Important changes
            after publication go back through review.
          </li>
          <li>
            <strong>Honoring registrations.</strong> You must deliver the
            conference as listed, and honor the passes and prices delegates
            registered against. Registrations are final. Don't promise
            delegates refunds for payments made through MUN Hub.
          </li>
          <li>
            <strong>Platform fee and payouts.</strong> Registration fees are
            collected on your behalf and paid out to the account you provide,
            minus MUN Hub's platform fee and applicable taxes, at the rate we
            agree with you before your conference is published. The account
            must belong to your organization or its authorized representative,
            and we verify it before paying out. We may set off payment errors,
            chargebacks, and amounts paid out in error against your payouts.
          </li>
          <li>
            <strong>Delegate data.</strong> You may use delegate information
            only to run your conference, and you must keep it secure. Don't
            sell it, share it with third parties, or use it for unrelated
            marketing.
          </li>
          <li>
            <strong>Safety.</strong> Many delegates are under 18. You're
            responsible for providing a safe, supervised, and respectful
            environment at your conference, and for complying with the laws
            that apply to your event.
          </li>
          <li>
            <strong>Your content.</strong> You keep ownership of the content
            you submit. You give us a non-exclusive, royalty-free licence to
            host, display, and adapt it (for example, resizing images) to
            operate and promote the Platform and your conference.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>When using the Platform, you must not:</p>
        <ul>
          <li>provide false information, or impersonate a person, school, or conference</li>
          <li>access another person's account or data, or try to</li>
          <li>interfere with seat limits, pricing, payments, or our review process</li>
          <li>
            probe, scan, or attack the Platform's security, or overload it
            with automated requests
          </li>
          <li>scrape or copy listings or user data without our written permission</li>
          <li>harass, threaten, or discriminate against anyone</li>
          <li>upload unlawful, infringing, or harmful content</li>
          <li>use the Platform for any unlawful purpose</li>
        </ul>
      </>
    ),
  },
  {
    id: "intellectual-property",
    title: "Our content",
    body: (
      <p>
        The Platform's design, software, text, and branding belong to MUN Hub
        or its licensors. You may use the Platform for its intended purpose,
        but you may not copy, modify, or redistribute it except as the law
        allows. Organizer content belongs to the organizer that submitted it.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and closing your account",
    body: (
      <>
        <p>
          We may suspend or close an account, or remove content, if you breach
          these terms, if the law requires it, or if we reasonably need to in
          order to protect delegates, organizers, or the Platform. Where we
          reasonably can, we'll tell you why.
        </p>
        <p>
          You can ask us to close your account at any time by writing to{" "}
          <a href={mailto(SITE_INFO.emails.support)}>{SITE_INFO.emails.support}</a>.
          Some records, such as payment and registration history, may be kept
          after closure where the law requires it, as explained in the{" "}
          <Link to="/legal/privacy">Privacy policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        We work to keep the Platform accurate and available, but we provide it
        “as is” and “as available”. To the extent the law allows, we don't
        promise that it will be uninterrupted or error-free, or that listings
        will stay unchanged after review. Conferences are delivered by their
        organizers, and we aren't responsible for an organizer's acts or
        omissions, or for what happens at a conference.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>To the extent the law allows:</p>
        <ul>
          <li>
            MUN Hub isn't liable for indirect or consequential losses, such as
            lost travel costs, lost opportunities, or lost profits.
          </li>
          <li>
            Our total liability to you for any claim about the Platform is
            limited to the amount you paid through MUN Hub for the
            registration the claim relates to.
          </li>
        </ul>
        <p>
          Nothing in these terms limits liability that can't be limited by
          law.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnity",
    body: (
      <p>
        If you're an organizer, you agree to compensate MUN Hub for claims,
        losses, and costs arising from your conference, your content, your
        use of delegate data, or your breach of these terms.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms as the Platform evolves. When we make a
        significant change, we'll let you know on the Platform or by email
        before it takes effect, and we may ask you to accept the new version.
        The date at the top of this page shows when the terms last changed.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law and disputes",
    body: (
      <p>
        These terms are governed by {SITE_INFO.governingLaw}. If a dispute
        comes up, please contact us first, and we'll try to resolve it
        informally. If we can't, the courts at {SITE_INFO.courts} have
        exclusive jurisdiction.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these terms? Write to{" "}
        <a href={mailto(SITE_INFO.emails.support)}>{SITE_INFO.emails.support}</a>{" "}
        or visit our <Link to="/contact">Contact page</Link>.
      </p>
    ),
  },
];

export function TermsPage() {
  return (
    <LegalDocument
      href="/legal/terms"
      title="Terms of service"
      description="The terms that apply when you use MUN Hub to discover, register for, or list Model United Nations conferences."
      lede="The agreement that applies when you use MUN Hub to find, register for, or list a Model UN conference."
      summary={[
        "MUN Hub is a marketplace. Organizers run their conferences, and we review listings, handle registration, and collect fees on the organizer's behalf.",
        "Delegates under 18 need a parent or guardian's consent to use MUN Hub.",
        "A seat is held for 15 minutes while you pay, and a registration is confirmed only once we've verified your payment.",
        "All payments are final. There are no refunds once a registration is paid, except for payment errors.",
        "Every registration includes MUN Hub's platform fee, which pays for our service.",
        "Organizers must keep listings accurate, honor what they publish, and use delegate data only to run their conference.",
      ]}
      sections={SECTIONS}
    />
  );
}
