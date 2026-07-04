"use client";

import { QueryProvider } from "@/components/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// App-shell client providers: TanStack Query, the radix Tooltip provider, and the
// sonner Toaster. Deliberately kept OUT of the root layout so public routes (landing,
// legal, demo, docs, status, changelog, auth) don't ship react-query + sonner +
// radix-tooltip in their first-load bundle. Added only to the app areas that use them
// (dashboard, admin, onboarding, dev). Renders under the root ThemeProvider, so the
// theme-aware Toaster still resolves next-themes.
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      <Toaster />
    </QueryProvider>
  );
}
