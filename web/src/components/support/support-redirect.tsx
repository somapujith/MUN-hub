import { useEffect } from "react";
import { Navigate } from "react-router";
import { isCrossOrigin } from "@/lib/host-routing";

/** Sends the visitor to `url`, which may be on another zone's host. */
export function SupportRedirect({ url }: { url: string }) {
  const crossOrigin = isCrossOrigin(url);
  useEffect(() => {
    if (crossOrigin) window.location.replace(url);
  }, [crossOrigin, url]);
  return crossOrigin ? null : <Navigate to={url} replace />;
}
