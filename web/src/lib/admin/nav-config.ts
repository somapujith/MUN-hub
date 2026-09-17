export const ADMIN_NAV_ITEMS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/review", label: "Applications", exact: false },
  { href: "/admin/verification", label: "Verification", exact: false },
  { href: "/admin/go-live-queue", label: "Go-live queue", exact: false },
  { href: "/admin/muns", label: "Conferences", exact: false },
  { href: "/admin/registrations", label: "Registrations", exact: false },
  { href: "/admin/payments", label: "Payments", exact: false },
  { href: "/admin/organizers", label: "Organizers", exact: false },
  { href: "/admin/support", label: "Support", exact: false },
  { href: "/admin/staff", label: "Staff", exact: false },
  { href: "/admin/audit", label: "Audit Log", exact: false },
] as const;

export const ADMIN_REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;
