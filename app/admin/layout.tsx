import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Shared secondary nav for every `/admin/*` page — one place to find every
 * console instead of guessing URLs. Each page underneath still renders its
 * own `SiteHeader`/`SiteFooter` (same as before this layout existed), so
 * this only injects a thin sub-nav bar between the site header and the
 * page's own content; it does not replace or duplicate page chrome.
 *
 * Role-gated here too (defense in depth) — the real boundary is
 * `requireRole` inside each server action, same reasoning as every
 * individual admin page's own redirect (see e.g. `app/admin/review/page.tsx`).
 * "MUNs" is deliberately absent: no `app/admin/muns` page exists yet, and
 * "Refunds" is deliberately absent: the refund workflow was built then
 * fully reverted for an unresolved concurrency bug — do not re-add it here
 * without a fresh implementation.
 */
const NAV_ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/review", label: "Applications" },
  { href: "/admin/verification", label: "Verification" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/organizers", label: "Organizers" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/audit", label: "Audit Log" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <nav aria-label="Admin" className="border-b border-border bg-surface-soft/60">
        <div className="content-container flex items-center gap-md overflow-x-auto py-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-sm px-2 py-1 text-body-md whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {children}
    </div>
  );
}
