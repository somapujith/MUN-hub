import { useEffect } from "react";

/**
 * Snaps a locally-held `page` index back into range once it lands past the
 * real last page — e.g. resolving/approving/publishing the only remaining
 * row on the current page of a filtered admin queue, which shrinks `total`
 * (and so `totalPages`) without changing `page` itself.
 *
 * Without this, the next fetch for that now out-of-range offset comes back
 * empty, and the page renders its "nothing here" empty state — which has no
 * pagination control on it, since Previous/Next only render next to a
 * non-empty result set. The admin is stuck with no way back to the rows
 * that still exist on an earlier page short of reloading or clearing a
 * filter. See payments-page.tsx (payment exceptions), go-live-queue-page.tsx,
 * review-page.tsx (Gate 1) and verification-page.tsx (Gate 2) — every list
 * here that pairs a mutation with a default non-"all" status filter can
 * shrink its own `total` this way.
 *
 * `onClamp`, when given, fires only on the render where a clamp actually
 * happens (not on every render, and not on the initial mount) — callers use
 * it to surface an unobtrusive notice, since otherwise the page number
 * changes with no indication why.
 */
export function usePageClamp(
  hasData: boolean,
  page: number,
  setPage: (page: number) => void,
  totalPages: number,
  onClamp?: (newPage: number) => void,
) {
  useEffect(() => {
    if (hasData && page > 0 && page >= totalPages) {
      const newPage = totalPages - 1;
      setPage(newPage);
      onClamp?.(newPage);
    }
    // onClamp is intentionally excluded: callers often pass an inline
    // function, which would re-run this effect (and could re-fire the
    // notice) on every render if it were a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, page, totalPages, setPage]);
}
