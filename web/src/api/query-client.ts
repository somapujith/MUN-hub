import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const status =
          error instanceof Error && "status" in error
            ? (error as Error & { status?: number }).status
            : undefined;
        if (status !== undefined && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});
