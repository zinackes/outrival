"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// App-wide TanStack Query client. The client is created once per browser session
// via useState (not at module scope) so a fresh client is never shared across
// requests during SSR. Defaults tuned for this app: data stays "fresh" for a
// minute (reswitching a tab serves the cache instead of refetching → no skeleton
// flash) and we don't refetch on window focus, since the dashboard already polls
// scrapes explicitly.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
