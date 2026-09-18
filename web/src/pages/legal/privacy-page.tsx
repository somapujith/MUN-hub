import { Link } from "react-router";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { SITE_INFO, mailto } from "@/lib/site-info";

const DATA_TABLE = [
  {
    category: "Account",
    examples: "Name, email address, and password. We store only a one-way hash of your password, never the password itself.",
  },
  {
    category: "Delegate profile",
    examples:
      "Date of birth, gender, preferred name, nationality, phone numbers, residential address, and transport needs. Also your school or college, year of study, course, department, student ID, and academic email.",
  },
  {
    category: "Emergency contacts",
    examples: "Parent or guardian name, phone number, and relationship to you, plus an optional alternate contact.",
  },
  {
    category: "MUN background",
    examples: "Number of MUNs attended, past experience and achievements, bio, interests, languages, and referral code. All of these are optional.",
  },
  {
    category: "Registrations",
    examples: "The conferences and passes you register for, your answers to each organizer's questions, and your registration status.",
  },
  {
    category: "Payments",
    examples:
      "Amount, status, and the reference IDs our payment gateway returns. We never see your full card number, UPI PIN, or banking passwords.",
  },
  {
    category: "Organizers",
    examples:
      "Organization and representative details, contact information, supporting documents, and payout details. Bank account and PAN numbers are encrypted, and we show only their last four digits.",
  },
  {
    category: "Consent records",
    examples: "When you accepted our Terms and Privacy policy, which version you accepted, and a guardian acknowledgement if one was needed.",
  },
  {
    category: "Support",
    examples: "The tickets and messages you send us.",
  },
  {
    category: "Technical",
    examples: "Your sign-in session, plus standard request logs (such as IP address and browser type) kept by our hosting providers for security.",
  },
];

const SECTIONS: LegalSection[] = [
  {
    id: "scope",
    title: "Who we are and what this covers",
    body: (
      <>
        <p>
          This policy explains how {SITE_INFO.name} (“we”, “us”) collects,
          uses, shares, and protects personal data when you use{" "}
          {SITE_INFO.domain} and its subdomains. For this data, we are the
          data fiduciary under India's Digital Personal Data Protection Act,
          2023.
        </p>
        <p>
          Once an organizer receives your registration details, they are also
          responsible for how they handle them at their conference.
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <>
        <p>
          We collect what you give us when you sign up, complete your profile,
          register, or contact us, along with a small amount of technical data
          needed to run the Platform securely.
        </p>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse text-left text-body-md">
            <caption className="sr-only">Categories of personal data we collect</caption>
            <thead className="bg-surface-soft">
              <tr>
                <th scope="col" className="w-28 px-sm py-sm font-medium text-ink sm:w-40 sm:px-md">
                  Category
                </th>
                <th scope="col" className="px-sm py-sm font-medium text-ink sm:px-md">
                  What it includes
                </th>
              </tr>
            </thead>
            <tbody>
              {DATA_TABLE.map((row) => (
                <tr key={row.category} className="border-t border-border align-top">
                  <th scope="row" className="px-sm py-sm font-medium text-ink sm:px-md">
                    {row.category}
                  </th>
                  <td className="px-sm py-sm leading-relaxed sm:px-md">{row.examples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use it",
    body: (
      <>
        <ul>
          <li>to create and secure your account, and keep you signed in</li>
          <li>to pre-fill registration forms, so you don't re-enter the same details for each conference</li>
          <li>to process registrations and payments, prevent overselling, and block duplicate charges</li>
          <li>to share your registration with the organizer of each conference you register for</li>
          <li>to verify organizers and review listings</li>
          <li>
            to send service messages, such as registration and payment updates
            and password resets
          </li>
          <li>to answer your support requests</li>
          <li>to detect fraud and abuse, and to keep records the law requires</li>
          <li>to understand how the Platform is used, so we can improve it</li>
        </ul>
        <p>
          <strong>We don't sell your personal data, and we don't show you
          advertising.</strong>
        </p>
      </>
    ),
  },
  {
    id: "who-can-see-it",
    title: "Who can see your information",
    body: (
      <>
        <h3>Organizers of conferences you register for</h3>
        <p>
          When you register, that conference's organizer receives the
          information they need to run it: your name, contact details,
          school or college, answers to their registration questions,
          registration and payment status, and emergency contact details.
          Organizers can't see your data for conferences they don't run, and
          they may use it only to run their conference.
        </p>
        <h3>The public</h3>
        <p>
          Nothing, by default. Your profile is private unless you choose to
          make it public. Even then, your emergency contacts, date of birth,
          address, and phone numbers are never shown publicly.
        </p>
        <h3>Our team</h3>
        <p>
          Authorized MUN Hub staff can access data where their role requires
          it, such as for support, listing review, or fraud prevention.
          Administrative actions are logged.
        </p>
        <h3>Service providers</h3>
        <p>
          We use trusted providers that process data on our instructions:
          cloud hosting and content delivery (Cloudflare, Vercel), database
          hosting (Neon), payment processing (our payment gateway partner),
          email delivery, and web fonts (Google Fonts, which receives your IP
          address when your browser loads the site's fonts).
        </p>
        <h3>When the law requires it</h3>
        <p>
          We may disclose information to comply with a legal obligation or a
          valid request from a public authority, or to protect someone's
          safety. If MUN Hub is ever part of a merger or acquisition, your data
          may transfer to the new owner under the same protections.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Delegates under 18",
    body: (
      <>
        <p>
          Many delegates are under 18. When a minor signs up, we ask for a
          parent or guardian's acknowledgement and record it. A parent or
          guardian can contact us at any time to review, correct, or delete
          their child's data.
        </p>
        <p>
          We don't track children's behavior across other sites, profile them
          for advertising, or show them targeted ads.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    body: (
      <>
        <ul>
          <li>
            <strong>One essential cookie</strong> keeps you signed in. It
            lasts up to 30 days and is shared across {SITE_INFO.domain}'s
            subdomains, so you stay signed in as you move between the
            marketplace, your dashboard, and organizer tools. It's marked
            HTTP-only, so scripts on the page can't read it.
          </li>
          <li>
            <strong>Your theme choice</strong> (light or dark) is saved in
            your browser's local storage.
          </li>
          <li>
            We don't use advertising cookies or third-party analytics
            trackers.
          </li>
        </ul>
        <p>
          If you block cookies, you won't be able to sign in.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <ul>
        <li>Passwords are stored only as salted one-way hashes.</li>
        <li>Organizer bank account and PAN numbers are encrypted, and our systems show only their last four digits.</li>
        <li>All traffic to the Platform is encrypted in transit (HTTPS).</li>
        <li>
          Access is permission-based. Delegates can see only their own data,
          and organizers only their own conferences' registrations.
        </li>
        <li>Resetting your password signs you out everywhere, and reset links expire after one hour.</li>
      </ul>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <ul>
          <li>
            <strong>Account and profile data</strong> are kept while your
            account is open, and deleted or anonymized after you ask us to
            close it.
          </li>
          <li>
            <strong>Registration and payment records</strong> are kept for as
            long as tax, accounting, and other applicable laws require, even
            after an account closes.
          </li>
          <li>
            <strong>Consent records</strong> are kept so we can show what you
            agreed to and when.
          </li>
          <li>
            <strong>Sign-in sessions</strong> expire after 30 days, and
            password reset links after one hour.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights and choices",
    body: (
      <>
        <p>Under applicable law, including the DPDP Act, you can:</p>
        <ul>
          <li>
            <strong>Access and correct</strong> your data. Most of it can be
            edited directly on your <Link to="/profile">profile page</Link>.
          </li>
          <li>
            <strong>Ask for deletion</strong> of your data, except for records
            we must keep by law.
          </li>
          <li>
            <strong>Withdraw consent</strong> at any time. This doesn't affect
            processing that already happened, and you may no longer be able to
            register for conferences.
          </li>
          <li>
            <strong>Choose your emails.</strong> You can turn optional email
            notifications off on your profile page. Essential service
            messages, such as payment confirmations and password resets, will
            still be sent.
          </li>
          <li>
            <strong>Nominate someone</strong> to exercise these rights for you
            if you die or become incapacitated.
          </li>
          <li>
            <strong>Raise a grievance</strong> with us, and escalate it to the
            Data Protection Board of India if you're not satisfied with our
            response.
          </li>
        </ul>
        <p>
          To make a request, email{" "}
          <a href={mailto(SITE_INFO.emails.privacy)}>{SITE_INFO.emails.privacy}</a>{" "}
          from the address on your account. We'll respond within the time the
          law requires.
        </p>
      </>
    ),
  },
  {
    id: "grievance-officer",
    title: "Grievance Officer",
    body: (
      <p>
        If you have a concern about how we handle your data, contact our
        Grievance Officer at{" "}
        <a href={mailto(SITE_INFO.emails.privacy)}>{SITE_INFO.emails.privacy}</a>{" "}
        or {SITE_INFO.phoneDisplay}. You can also write to us at{" "}
        {SITE_INFO.legalName} ({SITE_INFO.entityType}), {SITE_INFO.address.oneLine}.
        We'll acknowledge your complaint and work to resolve it promptly.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When we change how we handle personal data, we'll update this page
        and change the date at the top. If the change is significant, we'll
        notify you and, where required, ask for your consent again.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Privacy questions go to{" "}
        <a href={mailto(SITE_INFO.emails.privacy)}>{SITE_INFO.emails.privacy}</a>.
        For anything else, visit our <Link to="/contact">Contact page</Link>.
      </p>
    ),
  },
];

export function PrivacyPage() {
  return (
    <LegalDocument
      href="/legal/privacy"
      title="Privacy policy"
      description="What personal data MUN Hub collects, who can see it, how it's protected, and how to exercise your rights."
      lede="What we collect, why we collect it, who can see it, and the choices you have."
      summary={[
        "We collect what's needed to register you for conferences, including emergency contacts, because organizers need them.",
        "Only the organizers of conferences you register for receive your registration details. Your profile is private by default.",
        "We don't sell your data, show ads, or use third-party trackers.",
        "Passwords are hashed, and organizer bank details are encrypted.",
        "You can access, correct, or delete your data by emailing our privacy team.",
      ]}
      sections={SECTIONS}
    />
  );
}
