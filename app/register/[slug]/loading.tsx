import { SiteHeader } from "@/components/layout/site-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton mirroring the register page's header + two-column checkout body. */
export default function RegisterLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-xl px-lg py-xl sm:px-xl">
        <div className="flex flex-col gap-sm border-b border-border pb-lg">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="grid grid-cols-1 gap-xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="flex flex-col gap-lg">
            <Skeleton className="h-6 w-56" />
            <div className="flex flex-col gap-sm">
              <Skeleton className="h-20 w-full rounded-md" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
            <Skeleton className="h-12 w-48 rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-md" />
        </div>
      </main>
    </div>
  );
}
