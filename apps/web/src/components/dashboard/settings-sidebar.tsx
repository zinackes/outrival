"use client";

import { useState } from "react";
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
  Search,
  Trash2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { FEATURE_FLAGS } from "@outrival/shared";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { WorkspaceSwitcher, type Org } from "@/components/dashboard/sidebar";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  danger?: boolean;
  multiUserOnly?: boolean;
  // Extra terms the search box matches on, beyond the visible label — so e.g.
  // "2fa" or "password" jumps to Security, "invoice" to Subscription.
  keywords?: string;
}

// patch-29 — Variante 1 settings nav. Organised Personal / Workspace / Danger to be
// multi-user ready. Sections land as their pages ship (patch-29 phase 2): Personal
// gains Profile + Security; Workspace gains Members (flag), Integrations, API keys,
// Data. Routes here point at the pages that already exist.
const PERSONAL: NavItem[] = [
  { href: "/dashboard/settings/profile", label: "Profile", icon: User, exact: true, keywords: "name email avatar account change email" },
  { href: "/dashboard/settings/notifications", label: "Notifications", icon: Bell, exact: true, keywords: "alerts digest quiet hours timezone slack webhook severity batching email cap" },
  { href: "/dashboard/settings/security", label: "Security", icon: Lock, exact: true, keywords: "2fa two-factor authenticator totp password sessions devices sign out backup codes google connected accounts passkey" },
];

const WORKSPACE: NavItem[] = [
  { href: "/dashboard/settings/general", label: "General", icon: Building2, exact: true, keywords: "workspace name slug product url profile category" },
  { href: "/dashboard/settings/products", label: "Products", icon: Boxes, exact: true, keywords: "skus product add primary" },
  { href: "/dashboard/settings/members", label: "Members", icon: Users, exact: true, multiUserOnly: true, keywords: "team invite roles" },
  { href: "/dashboard/settings/billing", label: "Subscription", icon: CreditCard, keywords: "plan upgrade invoice payment stripe billing renew receipt" },
  { href: "/dashboard/settings/usage", label: "Usage", icon: Gauge, exact: true, keywords: "limits quota competitors battle cards rescans" },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Puzzle, exact: true, keywords: "slack webhook crm hubspot salesforce zapier" },
  { href: "/dashboard/settings/api-keys", label: "API keys", icon: Key, exact: true, keywords: "api token" },
  { href: "/dashboard/settings/data", label: "Data", icon: Database, exact: true, keywords: "export import gdpr retention privacy download" },
];

const DANGER: NavItem[] = [
  { href: "/dashboard/settings/danger", label: "Delete workspace", icon: Trash2, danger: true, keywords: "delete erase danger gdpr remove account close" },
];

export function SettingsSidebar({ org }: { org: Org }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const workspaceItems = WORKSPACE.filter(
    (it) => !it.multiUserOnly || FEATURE_FLAGS.multiUser,
  );
  const matches = (it: NavItem) =>
    !q ||
    it.label.toLowerCase().includes(q) ||
    (it.keywords?.includes(q) ?? false);
  const searchResults = [...PERSONAL, ...workspaceItems, ...DANGER].filter(matches);

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
        <WorkspaceSwitcher org={org} />
      </SidebarHeader>
      <SidebarContent className="no-scrollbar">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
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
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="py-1 group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                placeholder="Search settings…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7"
                aria-label="Search settings"
              />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {q ? (
          <SidebarGroup>
            <SidebarGroupContent>
              {searchResults.length > 0 ? (
                <SidebarMenu>{searchResults.map(renderItem)}</SidebarMenu>
              ) : (
                <p className="px-2 py-1.5 text-dense text-muted-foreground">
                  No settings match “{query}”.
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarSeparator className="my-1" />
            <SidebarGroup>
              <SidebarGroupLabel className="font-normal uppercase tracking-wide">
                Personal
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{PERSONAL.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel className="font-normal uppercase tracking-wide">
                Workspace
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{workspaceItems.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator className="my-1" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>{DANGER.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
