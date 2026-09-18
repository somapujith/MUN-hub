import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder for the registration funnel's single-column pages
 * (register before the mun has loaded, pay, confirmation) — all three share
 * the same shape (an eyebrow + title + subtitle header, then one bordered
 * content card, then a primary action) closely enough that this one
 * skeleton covers all of them without a blank flash while the mun/
 * registration query is still in flight. Renders its own `<main>` — drop it
 * in directly where those pages previously rendered an empty
 * `aria-busy="true"` div.
 */
export function RegistrationPageSkeleton() {
  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xxl sm:px-xl"
      aria-busy="true"
    >
      <div className="flex flex-col gap-xs">
        <Skeleton className="h-4 w-32 rounded-sm" />
        <Skeleton className="h-9 w-3/4 rounded-sm" />
        <Skeleton className="h-4 w-1/2 rounded-sm" />
      </div>
      <div className="flex flex-col gap-md rounded-md border border-border p-lg sm:p-xl">
        <Skeleton className="h-5 w-full rounded-sm" />
        <Skeleton className="h-5 w-full rounded-sm" />
        <Skeleton className="h-6 w-2/3 rounded-sm" />
      </div>
      <Skeleton className="h-11 w-40 rounded-md" />
    </main>
  );
}

/**
 * Loading placeholder for `<RegistrationForm>`'s own two-column shape (form
 * fields left, a 320px price-summary rail right) — for use once the mun
 * itself (and its real header) has already rendered via `RegistrationShell`,
 * while the availability/profile-defaults/account queries the form needs
 * before it can mount are still loading.
 */
export function RegistrationFormSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start" aria-busy="true">
      <div className="flex flex-col gap-lg">
        <Skeleton className="h-6 w-1/3 rounded-sm" />
        <div className="grid gap-md sm:grid-cols-2">
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
        </div>
        <Skeleton className="h-11 w-full rounded-sm" />
        <Skeleton className="h-24 w-full rounded-sm" />
        <Skeleton className="h-11 w-full rounded-sm" />
      </div>
      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  );
}
