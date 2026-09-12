import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunCardGrid } from "@/components/mun/mun-card-grid";
import { Button } from "@/components/ui/button";
import { searchMuns } from "@/lib/actions/marketplace";

export default async function Home() {
  const [upcoming, newlyAdded] = await Promise.all([
    searchMuns({ sortBy: "date", limit: 6 }),
    searchMuns({ sortBy: "newest", limit: 6 }),
  ]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-16 px-4 py-16 sm:px-6">
        <section className="flex flex-col gap-4">
          <h1 className="font-display max-w-2xl text-5xl font-semibold tracking-tight text-balance">
            Find your next Model UN.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Discover, compare, and register for Model United Nations conferences —
            curated committees, transparent pricing, verified organizers.
          </p>
          <div>
            <Button size="lg" render={<Link href="/muns" />}>
              Browse all MUNs
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold">Upcoming MUNs</h2>
            <Link href="/muns" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <MunCardGrid
            muns={upcoming.results}
            emptyMessage="No upcoming MUNs published yet — check back soon."
          />
        </section>

        <section className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold">Recently added</h2>
            <Link href="/muns" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <MunCardGrid
            muns={newlyAdded.results}
            emptyMessage="No MUNs published yet — check back soon."
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
