"use client";

// patch-29 — settings nav moved into the contextual sub-sidebar (Variante 1,
// rendered by DashboardShell on /dashboard/settings/*).
//
// OUT-38 — the column is left-aligned rather than centred. `mx-auto max-w-2xl`
// put the page title on a different vertical line from the shell around it, so
// the page had two leading edges and ~700px of dead space at 1440. Billing keeps
// its wider bound so the 4-up plan comparison doesn't cramp.
//
// The save bar lives here, not in each page: several forms on one page used to
// render several sticky bars, which stacked. One per page, fed by all of them.
import { usePathname } from "next/navigation";
import { SettingsSaveBarProvider } from "@/components/dashboard/settings-save-bar";
import { cn } from "@/lib/utils";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const wide = pathname?.startsWith("/dashboard/settings/billing");
  return (
    <div className={cn("w-full", wide ? "max-w-4xl" : "max-w-3xl")}>
      <SettingsSaveBarProvider>{children}</SettingsSaveBarProvider>
    </div>
  );
}
