import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "cn";
import { SECTION_SCROLL_OFFSET_PX } from "@/components/mun/mun-page-section";

/**
 * In-page section nav for the public MUN page — a sticky strip under the site
 * header. Links are plain `#id` anchors (they work without JS and can be
 * shared); the click handler only adds smooth scrolling that respects
 * reduced motion, and moves focus to the section heading.
 *
 * The active link tracks the last section whose top has scrolled past the
 * sticky chrome. On narrow screens the strip scrolls horizontally and keeps
 * the active link in view.
 */

export interface MunSectionNavItem {
  id: string;
  label: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MunSectionNav({ items }: { items: MunSectionNavItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  const idsKey = items.map((item) => item.id).join("|");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    let frame = 0;

    const update = () => {
      frame = 0;
      let current = ids[0] ?? null;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= SECTION_SCROLL_OFFSET_PX + 8) {
          current = id;
        }
      }
      // At the very bottom the last section may never reach the offset line.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && ids.length > 0) current = ids[ids.length - 1];
      setActiveId(current);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [idsKey]);

  // Keep the active link visible inside the horizontally scrolling strip,
  // adjusting only the strip's own scrollLeft (never the page).
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    const link = list.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(activeId)}"]`);
    if (!link) return;
    const left = link.offsetLeft - list.offsetLeft;
    const right = left + link.offsetWidth;
    if (left < list.scrollLeft) {
      list.scrollLeft = left - 16;
    } else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = right - list.clientWidth + 16;
    }
  }, [activeId]);

  const onClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    window.history.replaceState(window.history.state, "", `#${id}`);
    document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
    setActiveId(id);
  };

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      className="sticky top-16 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="content-container">
        <ul
          ref={listRef}
          className="relative -mx-xs flex list-none gap-xxs overflow-x-auto p-0 py-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  data-section-id={item.id}
                  aria-current={active ? "true" : undefined}
                  onClick={(event) => onClick(event, item.id)}
                  // text-body-md stays outside cn(): cn drops a custom text-*
                  // size token when a text colour class follows it.
                  className={`text-body-md ${cn(
                    "inline-flex items-center rounded-sm px-sm py-[6px] whitespace-nowrap",
                    "transition-colors duration-150 outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active
                      ? "bg-surface-soft font-medium text-ink"
                      : "text-body hover:bg-surface-soft hover:text-ink dark:text-muted-foreground dark:hover:text-foreground",
                  )}`}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
