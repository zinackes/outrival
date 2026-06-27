"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, ChevronRight, MoreHorizontal } from "lucide-react";

import { type Competitor } from "@/lib/api";
import { competitorsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { CompAvatar } from "./comp-avatar";

const CAP = 8;
const POLL_MS = 60_000;

// Competitor row: smooth neutral hover (no side border / stripe). Two-tier
// neutral fill encodes selection — hover is a light wash, the current row is a
// full fill + medium weight. Active beats hover via the more specific
// data-[active=true]:hover rule so hovering the selected row doesn't lighten it.
const COMP_ROW =
  "group/comp w-full transition-colors duration-150 ease-out motion-reduce:transition-none " +
  "hover:bg-sidebar-accent/60 " +
  "data-[active=true]:bg-sidebar-accent data-[active=true]:hover:bg-sidebar-accent data-[active=true]:font-medium";

function activity(c: Competitor) {
  return c.stats?.signals7d ?? 0;
}

function lastSignalMs(c: Competitor) {
  return c.stats?.lastSignalAt ? new Date(c.stats.lastSignalAt).getTime() : 0;
}

export function SidebarCompetitors() {
  const pathname = usePathname();
  // Shares the ["competitors"] cache with the Overview + Competitors pages; polls in
  // the background. Mutations elsewhere invalidate ["competitors"] → this refreshes
  // automatically via the shared cache (no manual event subscription needed).
  const compsQ = useQuery({ ...competitorsQuery(), refetchInterval: POLL_MS });
  const comps = compsQ.data ?? null;
  const [open, setOpen] = React.useState(true);

  const activeId = React.useMemo(() => {
    const m = pathname.match(/^\/dashboard\/competitors\/([^/]+)/);
    return m ? m[1]! : null;
  }, [pathname]);

  const parentActive =
    pathname === "/dashboard/competitors" ||
    pathname.startsWith("/dashboard/competitors/");

  const sorted = React.useMemo(() => {
    if (!comps) return [];
    return [...comps].sort((a, b) => {
      const da = activity(b) - activity(a);
      if (da !== 0) return da;
      const dl = lastSignalMs(b) - lastSignalMs(a);
      if (dl !== 0) return dl;
      return a.name.localeCompare(b.name);
    });
  }, [comps]);

  // Cap to the most active, but always keep the open competitor visible.
  const shown = React.useMemo(() => {
    const top = sorted.slice(0, CAP);
    if (activeId && !top.some((c) => c.id === activeId)) {
      const act = sorted.find((c) => c.id === activeId);
      if (act) top.push(act);
    }
    return top;
  }, [sorted, activeId]);

  const hiddenCount = sorted.length - shown.length;
  const hasAny = comps == null || comps.length > 0;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={parentActive} tooltip="Competitors">
        <Link href="/dashboard/competitors">
          <Users />
          <span>Competitors</span>
        </Link>
      </SidebarMenuButton>

      {hasAny && (
        <SidebarMenuAction
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse competitors" : "Expand competitors"}
        >
          <ChevronRight
            className={cn("transition-transform", open && "rotate-90")}
          />
        </SidebarMenuAction>
      )}

      {open && comps != null && comps.length > 0 && (
        <SidebarMenuSub className="mr-0 px-1.5">
          {shown.map((c) => {
            const n = activity(c);
            return (
              <SidebarMenuSubItem key={c.id}>
                <SidebarMenuSubButton
                  asChild
                  isActive={c.id === activeId}
                  className={COMP_ROW}
                >
                  <Link href={`/dashboard/competitors/${c.id}`}>
                    <CompAvatar name={c.name} url={c.url} color={c.color} size={22} />
                    <span className="truncate">{c.name}</span>
                    {n > 0 && (
                      <span className="ml-auto shrink-0 font-mono text-meta tabular-nums text-muted-foreground transition-colors duration-150 group-hover/comp:text-foreground group-data-[active=true]/comp:text-foreground motion-reduce:transition-none">
                        {n}
                      </span>
                    )}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
          {hiddenCount > 0 && (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                className="w-full text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none"
              >
                <Link href="/dashboard/competitors">
                  <MoreHorizontal />
                  <span>View all ({sorted.length})</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
