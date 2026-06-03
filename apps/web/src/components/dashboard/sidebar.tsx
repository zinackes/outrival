"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Radio,
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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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

interface Org {
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

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/signals", label: "Signals", icon: Radio },
  { href: "/dashboard/competitors", label: "Competitors", icon: Users },
  { href: "/dashboard/products", label: "Products", icon: Box },
  { href: "/dashboard/discovery", label: "Discovery", icon: Search },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function initials(name?: string | null, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

function WorkspaceSwitcher({ org }: { org: Org }) {
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
                  <span className="truncate text-[11px] text-[var(--muted-2)]">
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
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{NAV.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>{BOTTOM_NAV.map(renderItem)}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
