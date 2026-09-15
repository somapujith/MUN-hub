import { Link } from "react-router";
import { ClipboardListIcon, LayersIcon, LifeBuoyIcon, AlertTriangleIcon, RocketIcon } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { MOCK_ADMIN_OVERVIEW_CARDS } from "@/mocks/admin";

const ICONS = {
  "/admin/review": ClipboardListIcon,
  "/admin/verification": LayersIcon,
  "/admin/support": LifeBuoyIcon,
  "/admin/payments": AlertTriangleIcon,
} as const;

export function AdminOverviewPage() {
  const cards = [
    ...MOCK_ADMIN_OVERVIEW_CARDS,
    { label: "Go-live queue", value: 2, href: "/admin/go-live-queue" },
  ];

  return (
    <AdminPageFrame
      title="Overview"
      description="Current depth of every operations queue."
    >
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.href === "/admin/go-live-queue" ? RocketIcon : ICONS[card.href as keyof typeof ICONS] ?? ClipboardListIcon;
          return (
            <Link
              key={card.href}
              to={card.href}
              className="flex flex-col gap-sm rounded-md border border-border bg-card p-lg transition-colors hover:bg-surface-soft"
            >
              <Icon aria-hidden strokeWidth={1.75} className="size-5 text-muted-foreground" />
              <p className="text-body-md text-muted-foreground">{card.label}</p>
              <p className="font-display text-display-sm tabular-nums text-ink">{card.value}</p>
            </Link>
          );
        })}
      </div>
    </AdminPageFrame>
  );
}
