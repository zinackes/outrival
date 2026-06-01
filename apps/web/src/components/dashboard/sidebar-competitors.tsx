"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, ChevronRight, MoreHorizontal } from "lucide-react";

import { api, type Competitor } from "@/lib/api";
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

function activity(c: Competitor) {
  return c.stats?.signals7d ?? 0;
}

function lastSignalMs(c: Competitor) {
  return c.stats?.lastSignalAt ? new Date(c.stats.lastSignalAt).getTime() : 0;
}

export function SidebarCompetitors() {
  const pathname = usePathname();
  const [comps, setComps] = React.useState<Competitor[] | null>(null);
  const [open, setOpen] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await api.listCompetitors();
        if (alive) setComps(r.competitors);
      } catch {
        // keep last known list on transient errors
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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
        <SidebarMenuSub>
          {shown.map((c) => {
            const n = activity(c);
            return (
              <SidebarMenuSubItem key={c.id}>
                <SidebarMenuSubButton asChild isActive={c.id === activeId}>
                  <Link href={`/dashboard/competitors/${c.id}`}>
                    <CompAvatar name={c.name} size={18} />
                    <span className="truncate">{c.name}</span>
                    {n > 0 && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
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
              <SidebarMenuSubButton asChild className="text-muted-foreground">
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
