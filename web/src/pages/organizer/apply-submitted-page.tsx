import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { RequireAuth } from "@/guards/require-auth";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";

export function OrganizerApplySubmittedPage() {
  return (
    <RequireAuth>
      <Helmet title="Application submitted" />
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center">
          <div className="content-container">
            <div className="mx-auto flex max-w-xl flex-col items-start gap-lg py-xxl lg:py-section">
              <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success-text">
                <CheckIcon strokeWidth={1.75} className="size-6" />
              </span>
              <div className="flex flex-col gap-sm">
                <h1 className="font-display text-display-md text-balance text-ink">Application submitted</h1>
                <p className="text-title-md text-body text-pretty dark:text-muted-foreground">
                  Your conference is now in our review queue. We&apos;ll be in touch within
                  5 business days — you can track its status from your dashboard at any time.
                </p>
              </div>
              <div className="flex flex-col gap-sm sm:flex-row">
                <Button size="lg" render={<Link to="/organizer/dashboard" />}>
                  Go to dashboard
                  <ArrowRightIcon aria-hidden strokeWidth={1.75} />
                </Button>
                <Button variant="outline" size="lg" render={<Link to="/muns" />}>
                  Browse marketplace
                </Button>
              </div>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    </RequireAuth>
  );
}
