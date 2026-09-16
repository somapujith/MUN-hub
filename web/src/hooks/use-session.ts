import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { getSession } from "@/api/auth";

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
