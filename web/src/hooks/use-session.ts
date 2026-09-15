import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { fetchMockSession } from "@/mocks/session";

/**
 * Session read — staleTime: Infinity until sign-in/sign-out mutations
 * call queryClient.clear() (backend design §6.3).
 */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: fetchMockSession,
    staleTime: Infinity,
  });
}
