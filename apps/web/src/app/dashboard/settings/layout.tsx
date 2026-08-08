"use client";

// patch-29 — settings nav moved into the contextual sub-sidebar (Variante 1,
// rendered by DashboardShell on /dashboard/settings/*).
//
// The column is centred and bounded. OUT-38 had left-aligned it against
// `mx-auto max-w-2xl`, because a 672px column pinned left left ~700px of dead
// space at 1440 and gave the page a second leading edge. The dead space was the
// width, not the centring: at max-w-4xl the gutters are even and small enough
// that the offset from the shell's leading edge reads as a margin rather than as
// a second column. Billing keeps one step wider so the 4-up plan comparison
// doesn't cramp.
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
    <div className={cn("mx-auto w-full", wide ? "max-w-5xl" : "max-w-4xl")}>
      <SettingsSaveBarProvider>{children}</SettingsSaveBarProvider>
    </div>
  );
}
