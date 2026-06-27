"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationsBell } from "@/components/outrival/notifications-bell";
import { ProductSelector } from "@/components/outrival/product-selector";
import { GlobalSearch } from "@/components/dashboard/global-search";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { WhatsNewButton } from "@/components/dashboard/whats-new-button";
import { UserMenu } from "@/components/dashboard/user-menu";

interface User {
  name: string | null;
  email: string | null;
}

export function Topbar({ user }: { user: User }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <header className="h-[52px] border-b border-border px-4 lg:px-6 flex items-center gap-2 lg:gap-3 sticky top-0 z-20 bg-background/85 backdrop-blur-md">
      <SidebarTrigger className="-ml-1 size-8" />
      <div className="flex-1" />
      <GlobalSearch />
      <div className="flex-1" />
      <ProductSelector />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/ask">
              <Sparkles className="size-3.5 text-[var(--link)]" />
              Ask
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ask Outrival — answers from your data</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
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
      <WhatsNewButton />
      <NotificationsBell compact />
      <UserMenu user={user} />
    </header>
  );
}
