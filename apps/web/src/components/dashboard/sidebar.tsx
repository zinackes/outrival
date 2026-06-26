"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Radio,
  Activity,
  Sparkles,
  Globe,
  LineChart,
  Columns3,
  Users,
  Box,
  Search,
  Settings,
  ChevronsUpDown,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarCompetitors } from "@/components/dashboard/sidebar-competitors";
import { PLAN_LIMITS, planCanReachSectoral, type Plan } from "@outrival/shared";

export interface Org {
  name: string;
  plan?: string;
  seatsUsed?: number;
  seatsLimit?: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

// Overview stays ungrouped at the top (the landing); the rest split into three
// job-to-be-done groups, mirroring the grouped settings-sidebar.
const OVERVIEW: NavItem = {
  href: "/dashboard",
  label: "Overview",
  icon: LayoutDashboard,
  exact: true,
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { href: "/dashboard/signals", label: "Signals", icon: Radio },
      { href: "/dashboard/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "Analyze",
    items: [
      { href: "/dashboard/ask", label: "Ask", icon: Sparkles },
      { href: "/dashboard/sector", label: "Sector", icon: Globe },
      { href: "/dashboard/trends", label: "Trends", icon: LineChart },
      { href: "/dashboard/compare", label: "Compare", icon: Columns3 },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/dashboard/competitors", label: "Competitors", icon: Users },
      { href: "/dashboard/products", label: "Products", icon: Box },
      { href: "/dashboard/discovery", label: "Discovery", icon: Search },
    ],
  },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function initials(name?: string | null, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

export function WorkspaceSwitcher({ org }: { org: Org }) {
  const { isMobile } = useSidebar();
  const meta = [
    org.plan,
    org.seatsUsed != null && org.seatsLimit != null
      ? `${org.seatsUsed}/${org.seatsLimit} seats`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={org.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div
                className="flex aspect-square size-8 items-center justify-center rounded-md bg-foreground text-background"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {initials(org.name, "O")}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span
                  className="truncate text-sm font-bold"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  <span className="text-muted-foreground">Out</span>
                  <span className="text-foreground">rival</span>
                </span>
                {meta && (
                  <span className="truncate text-meta text-[var(--muted-2)]">
                    {meta}
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="w-56"
          >
            <DropdownMenuLabel className="text-xs text-[var(--muted-2)]">
              {org.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">
                <Settings className="size-3.5" /> Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings/billing">
                <CreditCard className="size-3.5" /> Subscription
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ org }: { org: Org }) {
  const pathname = usePathname();

  // Sector trends need a competitor floor (>= 4); a plan that can't reach it
  // (free, max 2) never populates the page, so drop it from the nav — the route
  // itself shows an upsell on direct access. Unknown plan → fail open (show it).
  const planKey = (org.plan ?? "").toLowerCase();
  const showSector =
    !(planKey in PLAN_LIMITS) || planCanReachSectoral(planKey as Plan);

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItem(it: NavItem) {
    if (it.href === "/dashboard/competitors") {
      return <SidebarCompetitors key={it.href} />;
    }
    const Ic = it.icon;
    const active = isActive(it.href, it.exact);
    return (
      <SidebarMenuItem key={it.href}>
        <SidebarMenuButton asChild isActive={active} tooltip={it.label}>
          <Link href={it.href}>
            <Ic />
            <span>{it.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher org={org} />
      </SidebarHeader>
      <SidebarContent className="gap-0 no-scrollbar">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>{renderItem(OVERVIEW)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {GROUPS.map((group) => {
          const items = showSector
            ? group.items
            : group.items.filter((it) => it.href !== "/dashboard/sector");
          return (
            <SidebarGroup key={group.label} className="py-1">
              <SidebarGroupLabel className="font-normal uppercase tracking-wide">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{items.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
        <SidebarSeparator className="my-1" />
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>{BOTTOM_NAV.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
