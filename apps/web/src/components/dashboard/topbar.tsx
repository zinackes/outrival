"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationsBell } from "@/components/outrival/notifications-bell";
import { GlobalSearch } from "@/components/dashboard/global-search";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { UserMenu } from "@/components/dashboard/user-menu";

interface User {
  name: string | null;
  email: string | null;
}

const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/signals": "Signals",
  "/dashboard/competitors": "Competitors",
  "/dashboard/candidates": "Detections",
  "/dashboard/settings/workspace": "Settings",
  "/dashboard/digests": "Digests",
  "/dashboard/alerts": "Alerts",
  "/dashboard/settings": "Settings",
  "/dashboard/settings/billing": "Subscription",
};

function titleFor(path: string): { primary: string; sub?: string } {
  const direct = ROUTE_TITLES[path];
  if (direct) return { primary: direct };

  if (path.startsWith("/dashboard/competitors/")) {
    return { primary: "Competitors", sub: "Detail" };
  }
  if (path.startsWith("/dashboard/settings/")) {
    return { primary: "Settings", sub: "Detail" };
  }
  return { primary: "Outrival" };
}

export function Topbar({ user }: { user: User }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { primary, sub } = titleFor(pathname);

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <header className="h-[52px] border-b border-border px-4 lg:px-6 flex items-center gap-2 lg:gap-3 sticky top-0 z-20 bg-background/85 backdrop-blur-md">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      <div className="font-mono text-xs text-muted-foreground/80 flex items-center gap-2">
        <span className="hidden sm:inline">Outrival</span>
        <ChevronRight size={12} className="hidden sm:inline" />
        <span className="text-foreground font-sans font-medium text-[13px]">
          {primary}
        </span>
        {sub && (
          <>
            <ChevronRight size={12} />
            <span className="text-muted-foreground font-sans font-medium text-[13px]">
              {sub}
            </span>
          </>
        )}
      </div>
      <div className="flex-1" />
      <GlobalSearch />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            onClick={refresh}
            disabled={isPending}
          >
            <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>
      <ThemeToggle />
      <NotificationsBell compact />
      <UserMenu user={user} />
    </header>
  );
}
