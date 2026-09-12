import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center sm:px-6">
        <span className="font-mono text-sm text-muted-foreground">404</span>
        <h1 className="font-display text-3xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">
          The page you're looking for doesn't exist or may have been moved.
        </p>
        <Button render={<Link href="/muns" />}>Browse MUNs</Button>
      </main>
      <SiteFooter />
    </div>
  );
}
