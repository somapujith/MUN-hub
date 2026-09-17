/** The published policies, in display order. Drives the legal switcher and /legal. */
export const LEGAL_DOCUMENTS = [
  {
    href: "/legal/terms",
    label: "Terms of service",
    description:
      "The agreement between you and MUN Hub: accounts, registrations, organizer obligations, and acceptable use.",
  },
  {
    href: "/legal/privacy",
    label: "Privacy policy",
    description:
      "What personal data we collect, who can see it, how long we keep it, and how to exercise your rights.",
  },
  {
    href: "/legal/refunds",
    label: "Refund policy",
    description:
      "Why all payments are final, the one exception for payment errors, and how MUN Hub's platform fee works.",
  },
] as const;

export type LegalHref = (typeof LEGAL_DOCUMENTS)[number]["href"];
