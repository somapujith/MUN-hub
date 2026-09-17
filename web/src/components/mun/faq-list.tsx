import { ChevronDownIcon } from "lucide-react";
import type { PublicMunFaq } from "@/types/public-mun";

/**
 * Organizer FAQs as a native disclosure list (`<details>`): keyboard and
 * screen-reader behaviour come from the platform, and every answer stays in
 * the DOM for in-page search.
 */
export function FaqList({ faqs }: { faqs: PublicMunFaq[] }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
      {faqs.map((faq) => (
        <details key={faq.id} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-md px-lg py-md text-label-md text-ink outline-none transition-colors duration-150 hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">{faq.question}</span>
            <ChevronDownIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <p className="px-lg pb-md text-body-md leading-relaxed whitespace-pre-line text-body dark:text-muted-foreground">
            {faq.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
