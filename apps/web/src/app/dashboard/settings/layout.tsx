"use client";

// patch-29 — settings nav moved into the contextual sub-sidebar (Variante 1,
// rendered by DashboardShell on /dashboard/settings/*). The layout constrains
// content width; billing runs wider so the 4-up plan comparison doesn't cramp.
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const wide = pathname?.startsWith("/dashboard/settings/billing");
  return (
    <div className={cn("mx-auto w-full", wide ? "max-w-4xl" : "max-w-2xl")}>
      {children}
    </div>
  );
}
