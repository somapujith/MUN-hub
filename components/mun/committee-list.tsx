import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import type { CommitteeWithPortfolios } from "@/lib/types";

/**
 * Committee grid — `demo-grid-card` / `article-card` treatment
 * (DESIGN-airtable.md § Cards & Containers): canvas background, {rounded.md}
 * (10px), hairline border, flat elevation. Card heights are deliberately left
 * to their content rather than stretched — the doc warns that uniform heights
 * "feel like a spec sheet".
 */

interface CommitteeListProps {
  committees: CommitteeWithPortfolios[];
}

export function CommitteeList({ committees }: CommitteeListProps) {
  if (committees.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
        <p className="text-body-md text-muted-foreground">
          Committees for this conference haven&apos;t been announced yet.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid list-none grid-cols-1 gap-lg p-0 md:grid-cols-2">
      {committees.map((committee) => (
        <CommitteeCard key={committee.id} committee={committee} />
      ))}
    </ul>
  );
}

function CommitteeCard({ committee }: { committee: CommitteeWithPortfolios }) {
  const openSeats = committee.portfolios.filter((p) => p.availability > 0).length;
  const hasPortfolios = committee.portfolios.length > 0;

  return (
    <li className="flex flex-col items-start rounded-md border border-border bg-card p-lg transition-colors">
      <div className="flex w-full items-start justify-between gap-sm">
        <h3 className="font-display text-title-sm font-medium tracking-[-0.006em] text-ink">
          {committee.name}
        </h3>
        {committee.capacity > 0 && (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {committee.capacity} seats
          </Badge>
        )}
      </div>

      {committee.agenda && (
        <p className="mt-sm text-body-md leading-relaxed text-body">{committee.agenda}</p>
      )}

      {committee.description && (
        <p className="mt-xs text-body-md leading-relaxed text-muted-foreground">
          {committee.description}
        </p>
      )}

      {hasPortfolios && (
        <div className="mt-md w-full border-t border-border pt-md">
          <p className="text-caption text-muted-foreground">
            Portfolios
            <span className="tabular-nums">
              {" "}
              · {openSeats} of {committee.portfolios.length} available
            </span>
          </p>
          <ul className="mt-xs flex list-none flex-wrap gap-xxs p-0">
            {committee.portfolios.map((portfolio) => {
              const taken = portfolio.availability === 0;
              return (
                <li key={portfolio.id}>
                  <Badge
                    variant={taken ? "secondary" : "outline"}
                    className={cn(taken && "text-muted-foreground line-through")}
                  >
                    {portfolio.name}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}
