"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/sidebar";
import { SettingsSidebar } from "@/components/dashboard/settings-sidebar";
import { Topbar } from "@/components/dashboard/topbar";

interface User {
  name: string | null;
  email: string | null;
}

interface Org {
  name: string;
  plan?: string;
  seatsUsed?: number;
  seatsLimit?: number;
}

export function DashboardShell({
  user,
  org,
  children,
  defaultOpen = true,
}: {
  user: User;
  org: Org;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  // patch-29 — Variante 1: the contextual settings sidebar replaces the main rail
  // on /dashboard/settings/* instead of stacking a second nav next to the content.
  const pathname = usePathname();
  const inSettings = pathname.startsWith("/dashboard/settings");

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      {inSettings ? <SettingsSidebar /> : <AppSidebar org={org} />}
      <SidebarInset>
        <div className="flex min-h-full w-full flex-col text-sm min-w-0">
          <Topbar user={user} />
          <div className="flex-1 min-w-0 w-full px-4 pt-5 pb-12 md:px-5 md:pt-6 lg:px-8 lg:pt-7 lg:pb-16">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
