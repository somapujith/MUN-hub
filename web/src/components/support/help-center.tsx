import * as React from "react";
import { ChevronDownIcon, MessageCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HELP_CATEGORY_META, type HelpTopic } from "@/components/support/help-topics";
import type { RequesterCategory } from "@/types/support";

export interface HelpCenterProps {
  topics: HelpTopic[];
  /** Display order for the category filter chips and the "all topics" grouping. */
  categories: RequesterCategory[];
  /** Anchor the "still need help" escalation scrolls to. */
  contactHref?: string;
}

function matchesQuery(topic: HelpTopic, query: string): boolean {
  if (!query) return true;
  const haystack = `${topic.question} ${topic.keywords ?? ""} ${HELP_CATEGORY_META[topic.category].label}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Self-serve help: search plus category browsing over `topics`, so a
 * requester can usually answer their own question before ever opening a
 * conversation. The "still need help" line at the bottom always links to
 * `contactHref` — the escalation path to the support chat (support-panel.tsx),
 * which is what actually reaches the admin/staff ticket queue.
 */
export function HelpCenter({ topics, categories, contactHref = "#contact-support" }: HelpCenterProps) {
  const [query, setQuery] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState<RequesterCategory | "ALL">("ALL");

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = React.useMemo(
    () =>
      topics.filter(
        (topic) =>
          (activeCategory === "ALL" || topic.category === activeCategory) && matchesQuery(topic, normalizedQuery),
      ),
    [topics, activeCategory, normalizedQuery],
  );

  const groups = React.useMemo(() => {
    if (activeCategory !== "ALL") return [{ category: activeCategory, topics: filtered }];
    return categories
      .map((category) => ({ category, topics: filtered.filter((topic) => topic.category === category) }))
      .filter((group) => group.topics.length > 0);
  }, [activeCategory, categories, filtered]);

  const isFiltered = normalizedQuery.length > 0 || activeCategory !== "ALL";

  return (
    <section aria-label="Help center" className="flex flex-col gap-md">
      <div className="flex flex-col gap-sm">
        <label htmlFor="help-search" className="sr-only">
          Search help topics
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-sm size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="help-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help topics — “refund”, “seat hold”, “password”…"
            className="pl-xl"
          />
        </div>

        <div className="flex flex-wrap gap-xs" role="group" aria-label="Filter by topic">
          <CategoryChip active={activeCategory === "ALL"} onClick={() => setActiveCategory("ALL")}>
            All topics
          </CategoryChip>
          {categories.map((category) => {
            const meta = HELP_CATEGORY_META[category];
            return (
              <CategoryChip key={category} active={activeCategory === category} onClick={() => setActiveCategory(category)}>
                <meta.icon className="size-3.5" aria-hidden />
                {meta.label}
              </CategoryChip>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border px-lg py-xl text-center">
          <p className="text-body-md text-ink">
            {normalizedQuery ? <>No help topics match &ldquo;{query.trim()}&rdquo;.</> : "No help topics in this category."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-xs">
            {isFiltered && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setActiveCategory("ALL");
                }}
              >
                <XIcon aria-hidden />
                Clear search
              </Button>
            )}
            <Button size="sm" render={<a href={contactHref} />}>
              <MessageCircleIcon aria-hidden />
              Message our support team
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-lg">
          {groups.map((group) => {
            const meta = HELP_CATEGORY_META[group.category];
            return (
              <div key={group.category} className="flex flex-col gap-xs">
                {activeCategory === "ALL" && (
                  <div className="flex items-baseline gap-xs">
                    <h2 className="font-display text-title-sm text-ink">{meta.label}</h2>
                    <span className="text-[12px] text-muted-foreground">{meta.blurb}</span>
                  </div>
                )}
                <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                  {group.topics.map((topic) => (
                    <TopicDisclosure key={topic.id} topic={topic} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-body-md text-muted-foreground">
        Didn&apos;t find what you needed?{" "}
        <a href={contactHref} className="text-link underline-offset-4 hover:underline">
          Message our support team
        </a>{" "}
        and we&apos;ll get back to you.
      </p>
    </section>
  );
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} size="sm" aria-pressed={active} onClick={onClick}>
      {children}
    </Button>
  );
}

function TopicDisclosure({ topic }: { topic: HelpTopic }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-md px-md py-sm text-body-md font-medium text-ink outline-none transition-colors duration-150 hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{topic.question}</span>
        <ChevronDownIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <p className="pr-md pb-sm pl-lg text-body-md leading-relaxed whitespace-pre-line text-muted-foreground [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4">
        {topic.answer}
      </p>
    </details>
  );
}
