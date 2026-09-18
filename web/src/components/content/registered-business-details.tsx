import type { ReactNode } from "react";
import { BuildingIcon, MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";
import { SITE_INFO, mailto, tel } from "@/lib/site-info";

/**
 * The registered business's legal name, address, phone, and owner email —
 * shown on About and Contact so a payment-gateway (or any other) website
 * verification pass finds real, matching KYC details without having to hunt
 * for them. Kept as one component so a future change to `SITE_INFO` never
 * drifts between the two pages.
 */
export function RegisteredBusinessDetails() {
  return (
    <div className="grid max-w-3xl gap-md rounded-lg border border-border p-lg sm:grid-cols-2">
      <Row icon={BuildingIcon} label="Registered as">
        {SITE_INFO.legalName} ({SITE_INFO.entityType})
      </Row>
      <Row icon={MapPinIcon} label="Registered address">
        {SITE_INFO.address.line1}
        <br />
        {SITE_INFO.address.city}, {SITE_INFO.address.state} {SITE_INFO.address.postalCode}
        <br />
        {SITE_INFO.address.country}
      </Row>
      <Row icon={PhoneIcon} label="Phone">
        <a
          href={tel(SITE_INFO.phone)}
          className="rounded-sm text-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {SITE_INFO.phoneDisplay}
        </a>
      </Row>
      <Row icon={MailIcon} label="Email">
        <a
          href={mailto(SITE_INFO.emails.owner)}
          className="rounded-sm text-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {SITE_INFO.emails.owner}
        </a>
      </Row>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof BuildingIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-sm">
      <span
        aria-hidden
        className="mt-px flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-soft text-ink"
      >
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">{label}</p>
        <p className="text-body-md leading-relaxed text-ink">{children}</p>
      </div>
    </div>
  );
}
