import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { MunCard } from "@/components/mun/mun-card";
import { MunCardSkeleton } from "@/components/mun/mun-card-skeleton";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardActions,
  SignatureCardDescription,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import { cn } from "cn";
import type { MunSummary } from "@/lib/types";

/**
 * Results grid — 3-up at desktop, 2 at tablet, 1 at mobile, {spacing.lg} (24px)
 * gutters per the doc's grid spec. Card heights are uniform on purpose: the
 * uneven-height rule in docs/prd/DESIGN-airtable.md is for marketing demo grids, and a
 * search surface has to stay scannable.
 *
 * The empty state is the single place this utility page reaches for brand
 * voltage — a `cream-callout-card` instead of a dashed placeholder box.
 */

const GRID_CLASSNAME = "grid grid-cols-1 gap-lg sm:grid-cols-2 xl:grid-cols-3";

interface MunCardGridProps {
  muns: MunSummary[];
  emptyMessage?: string;
  className?: string;
}

export function MunCardGrid({ muns, emptyMessage, className }: MunCardGridProps) {
  if (muns.length === 0) {
    return (
      <SignatureCard variant="cream" padding="lg" className="items-start">
        <SearchXIcon
          aria-hidden
          strokeWidth={1.5}
          className="mb-md size-6 text-[#181d26] opacity-70"
        />
        <SignatureCardTitle className="text-title-lg sm:text-title-lg">
          No conferences match those filters
        </SignatureCardTitle>
        <SignatureCardDescription className="text-[#333840]">
          {emptyMessage ??
            "Try widening your search — clear a location filter, or browse every published MUN on the platform."}
        </SignatureCardDescription>
        <SignatureCardActions>
          <Button variant="on-dark" size="sm" render={<Link href="/muns" />}>
            Clear all filters
          </Button>
        </SignatureCardActions>
      </SignatureCard>
    );
  }

  return (
    <div className={cn(GRID_CLASSNAME, className)}>
      {muns.map((mun) => (
        <MunCard key={mun.id} mun={mun} />
      ))}
    </div>
  );
}

export function MunCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={GRID_CLASSNAME}>
      {Array.from({ length: count }, (_, i) => (
        <MunCardSkeleton key={i} />
      ))}
    </div>
  );
}
