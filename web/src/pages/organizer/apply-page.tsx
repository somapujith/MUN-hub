import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { ArrowRightIcon } from "lucide-react";
import { RequireAuth } from "@/guards/require-auth";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STEPS = [
  "Submit this application",
  "Our team reviews it within 5 business days",
  "Build out committees, portfolios and pricing",
  "Go live and open registration",
];

export function OrganizerApplyPage() {
  return (
    <RequireAuth>
      <Helmet title="Host a MUN" />
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="flex-1 pb-section">
          <div className="content-container">
            <div className="grid gap-xl py-xxl lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-section lg:py-section">
              <div className="flex max-w-2xl flex-col gap-xl">
                <header className="flex flex-col gap-md">
                  <p className="text-caption text-muted-foreground">For organizers</p>
                  <h1 className="font-display text-display-md text-balance text-ink lg:text-display-lg">
                    Host your MUN on MUN Hub
                  </h1>
                  <p className="text-title-md text-body text-pretty dark:text-muted-foreground">
                    Tell us about your conference. Once approved, you&apos;ll get a public listing,
                    a delegate roster, and payments handled end to end.
                  </p>
                </header>
                <form className="flex flex-col gap-md rounded-md border border-border bg-card p-lg" onSubmit={(e) => e.preventDefault()}>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="org-name">Organization name</Label>
                    <Input id="org-name" placeholder="Campus Diplomacy Society" disabled />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="mun-name">Conference name</Label>
                    <Input id="mun-name" placeholder="Hyderabad MUN 2026" disabled />
                  </div>
                  <p className="text-body-md text-muted-foreground">Form wiring deferred — mock shell only.</p>
                  <Button type="button" disabled>Submit application</Button>
                </form>
              </div>
              <aside>
                <div className="flex flex-col gap-md rounded-md border border-border bg-surface-soft p-lg lg:sticky lg:top-24 dark:bg-card">
                  <h2 className="font-display text-label-md text-ink">What happens next</h2>
                  <ol className="flex flex-col gap-sm">
                    {STEPS.map((step, index) => (
                      <li key={step} className="flex items-start gap-sm text-body-md text-body dark:text-muted-foreground">
                        <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-legal tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="text-pretty">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <Button variant="outline" size="sm" render={<Link to="/muns" />}>
                    Browse conferences
                    <ArrowRightIcon aria-hidden strokeWidth={1.75} />
                  </Button>
                </div>
              </aside>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    </RequireAuth>
  );
}
