import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunStatusBadge } from "@/components/mun/mun-status-badge";
import type { MunStatus } from "@/lib/mun-status";

const PREVIEW_STATUSES: MunStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "REJECTED",
  "APPROVED",
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "COMPLETED",
  "ARCHIVED",
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-24 sm:px-6">
        <h1 className="font-display text-5xl font-semibold tracking-tight text-balance">
          Find your next Model UN.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Marketplace is under construction — server actions land shortly. Design tokens and
          status system preview below.
        </p>
        <div className="flex flex-wrap gap-2 pt-4">
          {PREVIEW_STATUSES.map((status) => (
            <MunStatusBadge key={status} status={status} />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
