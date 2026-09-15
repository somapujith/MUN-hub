import type { ReactNode } from "react";
import { Link } from "react-router";
import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import type { Role } from "@/types/enums";

/** UX-only role gate — 403, not login loop. Server is authoritative. */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly Role[];
  children: ReactNode;
}) {
  const { data: session } = useSession();

  if (!session) return children;

  if (!roles.includes(session.role)) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-background">
        <Helmet>
          <title>Access denied</title>
        </Helmet>
        <SiteHeader session={session} />
        <main className="content-container flex flex-1 flex-col justify-center gap-md py-xxl">
          <p className="text-caption uppercase text-muted-foreground">403</p>
          <h1 className="font-display text-display-md text-ink">Access denied</h1>
          <p className="max-w-[50ch] text-body-md text-muted-foreground">
            Your account doesn&apos;t have permission to view this page.
          </p>
          <Button render={<Link to="/" />} className="self-start">
            Back to home
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return children;
}
