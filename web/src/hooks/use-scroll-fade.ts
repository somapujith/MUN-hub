import { useEffect, useRef } from "react";
import { attachScrollFade, type ScrollFadeAxis } from "@/lib/scroll-fade";

/**
 * Convenience wrapper around `attachScrollFade` for scrollable strips that
 * don't already manage their own ref for something else (see that file's
 * header comment for why this isn't the only way to use it). Attach the
 * returned ref to the scrollable element itself.
 */
export function useScrollFadeRef<T extends HTMLElement>(axis: ScrollFadeAxis = "x") {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachScrollFade(el, axis);
  }, [axis]);

  return ref;
}
