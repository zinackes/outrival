"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/sidebar";
import { SettingsSidebar } from "@/components/dashboard/settings-sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { AskContextProvider } from "@/components/dashboard/ask-context";
import { AskDock } from "@/components/dashboard/ask-dock";
import { GetStartedDock } from "@/components/dashboard/get-started-dock";
import { ProductScopeProvider } from "@/components/dashboard/product-scope-provider";
import { cn } from "@/lib/utils";

interface User {
  name: string | null;
  email: string | null;
}

interface Org {
  plan?: string;
  competitorsUsed?: number;
}

export function DashboardShell({
  user,
  org,
  children,
  defaultOpen = true,
  productScope = null,
}: {
  user: User;
  org: Org;
  children: React.ReactNode;
  defaultOpen?: boolean;
  productScope?: string | null;
}) {
  // patch-29 — Variante 1: the contextual settings sidebar replaces the main rail
  // on /dashboard/settings/* instead of stacking a second nav next to the content.
  const pathname = usePathname();
  const inSettings = pathname.startsWith("/dashboard/settings");
  // Signals is a workspace, not a document: it owns the viewport under the topbar
  // and scrolls inside its own columns, so the page padding and page scroll are
  // handed back to it. Every other route keeps the padded, scrolling shell.
  const fullBleed = pathname === "/dashboard/signals";

  return (
    // reducedMotion="user" — every motion component in the dashboard (filtered
    // feeds, etc.) drops transforms and keeps opacity for users who ask for it.
    <MotionConfig reducedMotion="user">
      <ProductScopeProvider initial={productScope}>
        <AskContextProvider>
          <SidebarProvider defaultOpen={defaultOpen}>
            {inSettings ? (
              <SettingsSidebar org={org} user={user} />
            ) : (
              <AppSidebar org={org} user={user} />
            )}
            {/* The signals workspace owns the viewport: pin the inset too, so
                nothing behind the panes can scroll and inherit their overscroll. */}
            <SidebarInset className={cn(fullBleed && "h-dvh overflow-hidden")}>
              <div
                className={cn(
                  "flex w-full flex-col text-sm min-w-0",
                  fullBleed ? "h-dvh" : "min-h-full",
                )}
              >
                <Topbar user={user} />
                <div
                  id="main-content"
                  tabIndex={-1}
                  className={cn(
                    "flex-1 min-w-0 w-full outline-none",
                    fullBleed
                      ? "flex min-h-0 flex-col overflow-hidden"
                      : "px-4 pt-5 pb-12 md:px-5 md:pt-6 lg:px-8 lg:pt-7 lg:pb-16",
                  )}
                >
                  {children}
                </div>
              </div>
              <AskDock />
              <GetStartedDock />
            </SidebarInset>
          </SidebarProvider>
        </AskContextProvider>
      </ProductScopeProvider>
    </MotionConfig>
  );
}
