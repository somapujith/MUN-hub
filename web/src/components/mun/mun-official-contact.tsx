import { GlobeIcon, MailIcon, PhoneIcon, type LucideIcon } from "lucide-react";
import { safeWebsiteUrl } from "@/components/mun/mun-format";
import type { PublicMunContact } from "@/types";

/**
 * A MUN's official contact channels (email, phone, website) — rendered on the
 * cream organizer card, so ink is the card's fixed #181d26 rather than a
 * theme token. The organizer's named contact person is never part of the
 * public payload.
 */

function ContactLink({ icon: Icon, href, label, external }: { icon: LucideIcon; href: string; label: string; external?: boolean }) {
  return (
    <li>
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="inline-flex items-center gap-xs rounded-sm break-all text-[#181d26] underline decoration-[#181d26]/40 underline-offset-4 outline-none hover:decoration-[#181d26] focus-visible:ring-2 focus-visible:ring-[#181d26]"
      >
        <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
        {label}
        {external && <span className="sr-only"> (opens in a new tab)</span>}
      </a>
    </li>
  );
}

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return /^\+?\d{6,15}$/.test(digits) ? `tel:${digits}` : null;
}

export function MunOfficialContact({ contact }: { contact: PublicMunContact }) {
  const phoneHref = contact.phone ? telHref(contact.phone) : null;
  const website = safeWebsiteUrl(contact.website);
  const websiteLabel = website ? new URL(website).host.replace(/^www\./, "") : null;

  // The API validates the address on write; this only keeps a malformed value
  // from turning into a mailto with extra headers.
  const email = /^[^\s@?&#]+@[^\s@?&#]+$/.test(contact.officialEmail) ? contact.officialEmail : null;

  return (
    <ul className="mt-lg flex list-none flex-col gap-xs p-0 text-body-md sm:flex-row sm:flex-wrap sm:gap-x-lg">
      {email && <ContactLink icon={MailIcon} href={`mailto:${email}`} label={email} />}
      {contact.phone && phoneHref && <ContactLink icon={PhoneIcon} href={phoneHref} label={contact.phone} />}
      {website && websiteLabel && <ContactLink icon={GlobeIcon} href={website} label={websiteLabel} external />}
    </ul>
  );
}
