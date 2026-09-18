/**
 * Scroll-fade affordance for horizontally- (or vertically-) scrolling
 * strips: a soft edge fade that hints "there's more to scroll to", and
 * disappears once you've actually scrolled that direction all the way.
 *
 * Implemented as a CSS `mask-image` on the scrollable element itself,
 * updated imperatively on scroll/resize — not a React-state + two
 * absolutely-positioned gradient divs — so it works regardless of what
 * background color/opacity/blur the strip happens to use at each call
 * site (surface-soft, background/95 + backdrop-blur, transparent, …).
 * `mask-image` fades the element's own painted pixels to transparent,
 * so whatever is behind it always shows through correctly.
 *
 * Deliberately a plain DOM-attaching function, not a hook that owns its
 * own ref: several call sites already manage the scrollable element's ref
 * for other reasons (active-tab reveal, wheel-redirect, active-link
 * tracking) via a ref callback, precisely because content behind an async
 * auth/data gate can mount well after the component's first render — a
 * plain `useRef` + mount-only `useEffect` would miss that later mount (see
 * admin-layout.tsx's own comment on the same problem). Callers with that
 * kind of existing ref plumbing call `attachScrollFade` directly inside
 * it; simple cases use the `useScrollFadeRef` convenience hook below.
 */

const FADE_SIZE_PX = 40;

export type ScrollFadeAxis = "x" | "y";

/**
 * Attaches scroll/resize listeners to `el` that keep its `mask-image`
 * in sync with how much overflow is hidden on each side. Returns a
 * cleanup function.
 */
export function attachScrollFade(el: HTMLElement, axis: ScrollFadeAxis = "x"): () => void {
  const isX = axis === "x";
  const direction = isX ? "to right" : "to bottom";

  const clearMask = () => {
    el.style.maskImage = "";
    el.style.webkitMaskImage = "";
  };

  const update = () => {
    const scrollPos = isX ? el.scrollLeft : el.scrollTop;
    const scrollSize = isX ? el.scrollWidth : el.scrollHeight;
    const clientSize = isX ? el.clientWidth : el.clientHeight;
    const maxScroll = scrollSize - clientSize;

    // Nothing hidden in either direction: no mask needed at all.
    if (maxScroll <= 1) {
      clearMask();
      return;
    }

    const atStart = scrollPos <= 1;
    const atEnd = scrollPos >= maxScroll - 1;

    const stops: string[] = [];
    stops.push(atStart ? "black 0px" : "transparent 0px");
    if (!atStart) stops.push(`black ${FADE_SIZE_PX}px`);
    stops.push(atEnd ? "black 100%" : `black calc(100% - ${FADE_SIZE_PX}px)`);
    if (!atEnd) stops.push("transparent 100%");

    const mask = `linear-gradient(${direction}, ${stops.join(", ")})`;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  };

  update();
  el.addEventListener("scroll", update, { passive: true });
  const resizeObserver = new ResizeObserver(update);
  resizeObserver.observe(el);
  window.addEventListener("resize", update);

  return () => {
    el.removeEventListener("scroll", update);
    resizeObserver.disconnect();
    window.removeEventListener("resize", update);
    clearMask();
  };
}
