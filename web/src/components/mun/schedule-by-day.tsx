import { MapPinIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDayHeading, formatTime, localDayKey } from "@/components/mun/mun-format";
import { SCHEDULE_KIND_LABELS } from "@/lib/mun-public-labels";
import type { PublicScheduleItem } from "@/types/public-mun";

/**
 * Conference schedule grouped into days ("Day 1 · Friday, 10 January"), each
 * day a hairline list of time-ranged rows. Items arrive ordered by start time;
 * ties keep the organizer's display order.
 */

interface ScheduleByDayProps {
  items: PublicScheduleItem[];
  committees: { id: string; name: string }[];
}

export function ScheduleByDay({ items, committees }: ScheduleByDayProps) {
  const committeeNames = new Map(committees.map((committee) => [committee.id, committee.name]));

  const sorted = [...items].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.displayOrder - b.displayOrder,
  );

  const days: { key: string; date: Date; items: PublicScheduleItem[] }[] = [];
  for (const item of sorted) {
    const key = localDayKey(item.startsAt);
    const current = days[days.length - 1];
    if (current && current.key === key) {
      current.items.push(item);
    } else {
      days.push({ key, date: item.startsAt, items: [item] });
    }
  }

  return (
    <ol className="flex list-none flex-col gap-xl p-0">
      {days.map((day, index) => (
        <li key={day.key}>
          <h3 className="font-display text-title-sm font-medium tracking-[-0.006em] text-ink">
            Day {index + 1}
            <span className="font-normal text-muted-foreground"> · {formatDayHeading(day.date)}</span>
          </h3>
          <ul className="mt-sm list-none divide-y divide-border overflow-hidden rounded-md border border-border bg-card p-0">
            {day.items.map((item) => {
              const committeeName = item.committeeId ? committeeNames.get(item.committeeId) : undefined;
              return (
                <li key={item.id} className="flex flex-col gap-xxs px-lg py-md sm:flex-row sm:gap-lg">
                  <p className="shrink-0 text-body-md tabular-nums text-body sm:w-[150px] dark:text-muted-foreground">
                    <time dateTime={item.startsAt.toISOString()}>{formatTime(item.startsAt)}</time>
                    {" – "}
                    <time dateTime={item.endsAt.toISOString()}>{formatTime(item.endsAt)}</time>
                  </p>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-xs">
                      <p className="text-label-md text-ink">{item.title}</p>
                      <Badge variant="secondary">{SCHEDULE_KIND_LABELS[item.kind] ?? "Event"}</Badge>
                    </div>
                    {(committeeName || item.location) && (
                      <p className="mt-xxs flex flex-wrap items-center gap-x-sm gap-y-xxs text-body-md text-muted-foreground">
                        {committeeName && <span>{committeeName}</span>}
                        {item.location && (
                          <span className="inline-flex items-center gap-xxs">
                            <MapPinIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
                            {item.location}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
