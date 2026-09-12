import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder mirroring <MunCard>'s exact geometry — same {rounded.md}
 * shell, 16px padding, same three-row rhythm and footer rule — so the swap from
 * skeleton to real card doesn't shift layout.
 */
export function MunCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex h-full flex-col gap-sm rounded-md border border-border bg-card p-md"
    >
      <div className="flex items-start justify-between gap-sm">
        <Skeleton className="h-5 w-3/5 rounded-sm" />
      </div>

      <div className="flex flex-col gap-xxs pt-xxs">
        <Skeleton className="h-3.5 w-2/5 rounded-sm" />
        <Skeleton className="h-3.5 w-1/2 rounded-sm" />
      </div>

      <div className="mt-auto pt-xs">
        <Skeleton className="h-5 w-28 rounded-pill" />
      </div>

      <div className="-mx-md mt-sm flex items-center justify-between gap-sm border-t border-border px-md pt-sm">
        <Skeleton className="h-3.5 w-24 rounded-sm" />
        <Skeleton className="h-4 w-14 rounded-sm" />
      </div>
    </div>
  );
}
