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
 */
export function usePageClamp(hasData: boolean, page: number, setPage: (page: number) => void, totalPages: number) {
  useEffect(() => {
    if (hasData && page > 0 && page >= totalPages) {
      setPage(totalPages - 1);
    }
  }, [hasData, page, totalPages, setPage]);
}
