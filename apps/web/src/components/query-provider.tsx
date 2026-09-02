"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shouldRetryQuery } from "@/lib/error-helpers";

// App-wide TanStack Query client. The client is created once per browser session
// via useState (not at module scope) so a fresh client is never shared across
// requests during SSR. Defaults tuned for this app: data stays "fresh" for a
// minute (reswitching a tab serves the cache instead of refetching → no skeleton
// flash), we don't refetch on window focus since the dashboard already polls
// scrapes explicitly, and a client error is never retried.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            // A 4xx is final, so it surfaces on the first answer instead of after
            // three more identical requests (`ux:10`).
            retry: shouldRetryQuery,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
