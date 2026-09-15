import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { RouterProvider } from "react-router";
import { queryClient } from "@/api/query-client";
import { router } from "@/routes";

export default function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </HelmetProvider>
  );
}
