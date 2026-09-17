import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { getSession } from "@/api/auth";
import { apiCredentialsMode } from "@/lib/host-routing";

/**
 * Who's signed in, straight from the API (`GET /auth/session`), resolving to
 * `null` when signed out rather than throwing — every consumer (the header,
 * RequireAuth, RequireRole) branches on presence, not on error state.
 *
 * `staleTime: Infinity` because the session only changes through sign-in /
 * sign-up / sign-out, and each of those explicitly invalidates this key. A
 * failed request is treated as signed-out rather than retried: the endpoint
 * answers "who am I" and a network blip shouldn't strand the UI in a loading
 * state that RequireAuth renders as a skeleton forever.
 */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: async () => {
      // A per-MUN slug host never sends the session cookie (and the API
      // wouldn't let it read the answer), so it is always signed out.
      if (apiCredentialsMode() === "omit") return null;
      try {
        return await getSession();
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
}
