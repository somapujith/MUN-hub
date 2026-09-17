import type { ReactNode } from "react";
import { Link } from "react-router";
import { isCrossOrigin } from "@/lib/host-routing";

/** `<Link>` for same-origin URLs, a plain anchor when the URL is on another host. */
export function ZoneLink({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  return isCrossOrigin(url) ? (
    <a href={url} className={className}>
      {children}
    </a>
  ) : (
    <Link to={url} className={className}>
      {children}
    </Link>
  );
}
