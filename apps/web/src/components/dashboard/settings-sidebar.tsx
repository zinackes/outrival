"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Building2,
  Boxes,
  CreditCard,
  Database,
  Gauge,
  Key,
  Lock,
  Puzzle,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { FEATURE_FLAGS } from "@outrival/shared";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  danger?: boolean;
  multiUserOnly?: boolean;
}

// patch-29 — Variante 1 settings nav. Organised Personal / Workspace / Danger to be
// multi-user ready. Sections land as their pages ship (patch-29 phase 2): Personal
// gains Profile + Security; Workspace gains Members (flag), Integrations, API keys,
// Data. Routes here point at the pages that already exist.
const PERSONAL: NavItem[] = [
  { href: "/dashboard/settings/profile", label: "Profile", icon: User, exact: true },
  { href: "/dashboard/settings/notifications", label: "Notifications", icon: Bell, exact: true },
  { href: "/dashboard/settings/security", label: "Security", icon: Lock, exact: true },
];

const WORKSPACE: NavItem[] = [
  { href: "/dashboard/settings/general", label: "General", icon: Building2, exact: true },
  { href: "/dashboard/settings/products", label: "Products", icon: Boxes, exact: true },
  { href: "/dashboard/settings/members", label: "Members", icon: Users, exact: true, multiUserOnly: true },
  { href: "/dashboard/settings/billing", label: "Subscription", icon: CreditCard },
  { href: "/dashboard/settings/usage", label: "Usage", icon: Gauge, exact: true },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Puzzle, exact: true },
  { href: "/dashboard/settings/api-keys", label: "API keys", icon: Key, exact: true },
  { href: "/dashboard/settings/data", label: "Data", icon: Database, exact: true },
];

const DANGER: NavItem[] = [
  { href: "/dashboard/settings/danger", label: "Delete workspace", icon: Trash2, danger: true },
];

const GROUP_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--muted-2)",
};

export function SettingsSidebar() {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItem(it: NavItem) {
    const Ic = it.icon;
    return (
      <SidebarMenuItem key={it.href}>
        <SidebarMenuButton
          asChild
          isActive={isActive(it.href, it.exact)}
          tooltip={it.label}
          className={cn(it.danger && "text-critical hover:text-critical")}
        >
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to dashboard">
              <Link href="/dashboard">
                <ArrowLeft />
                <span>Back to dashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel style={GROUP_LABEL_STYLE}>Personal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{PERSONAL.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel style={GROUP_LABEL_STYLE}>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {WORKSPACE.filter(
                (it) => !it.multiUserOnly || FEATURE_FLAGS.multiUser,
              ).map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>{DANGER.map(renderItem)}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
