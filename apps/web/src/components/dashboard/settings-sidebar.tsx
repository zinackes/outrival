"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Icon as PhosphorIcon } from "@/components/icons";
import {
  ArrowLeftIcon,
  BellIcon,
  BuildingsIcon,
  CardsThreeIcon,
  CreditCardIcon,
  DatabaseIcon,
  GaugeIcon,
  KeyIcon,
  LockIcon,
  PuzzlePieceIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  WorkspaceSwitcher,
  type Org,
  type SwitcherUser,
} from "@/components/dashboard/sidebar";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
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
  { href: "/dashboard/settings/profile", label: "Profile", icon: UserIcon, exact: true, keywords: "name email avatar account change email" },
  { href: "/dashboard/settings/notifications", label: "Notifications", icon: BellIcon, exact: true, keywords: "alerts digest quiet hours timezone slack webhook severity batching email cap conditions important flag rules" },
  { href: "/dashboard/settings/security", label: "Security", icon: LockIcon, exact: true, keywords: "2fa two-factor authenticator totp password sessions devices sign out backup codes google connected accounts passkey" },
];

const WORKSPACE: NavItem[] = [
  { href: "/dashboard/settings/general", label: "General", icon: BuildingsIcon, exact: true, keywords: "workspace name slug product url profile category monitoring defaults sources reference volumes meter" },
  { href: "/dashboard/settings/products", label: "Products", icon: CardsThreeIcon, exact: true, keywords: "skus product add primary" },
  { href: "/dashboard/settings/members", label: "Members", icon: UsersIcon, exact: true, multiUserOnly: true, keywords: "team invite roles" },
  { href: "/dashboard/settings/billing", label: "Subscription", icon: CreditCardIcon, keywords: "plan upgrade invoice payment stripe billing renew receipt" },
  { href: "/dashboard/settings/usage", label: "Usage", icon: GaugeIcon, exact: true, keywords: "limits quota competitors battle cards rescans" },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: PuzzlePieceIcon, exact: true, keywords: "crm hubspot salesforce zapier make webhooks destinations" },
  { href: "/dashboard/settings/api-keys", label: "API keys", icon: KeyIcon, exact: true, keywords: "api token" },
  { href: "/dashboard/settings/data", label: "Data", icon: DatabaseIcon, exact: true, keywords: "export import gdpr retention privacy download shared reports links" },
];

// The group is Danger zone; the entry keeps its own name. Labelling the GROUP
// "Delete workspace" described one of the two things the page it opens does —
// it deletes accounts too.
const DANGER: NavItem[] = [
  { href: "/dashboard/settings/danger", label: "Delete workspace", icon: TrashIcon, danger: true, keywords: "delete erase danger gdpr remove account close" },
];

/**
 * Does this item match the query?
 *
 * Every whitespace-separated term must appear somewhere in the label or the
 * keywords. The previous test was `keywords.includes(query)` against one raw
 * string, so "email cap" matched Notifications and "cap email" did not — the
 * order the terms happen to sit in the source decided the result.
 */
function matches(item: NavItem, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${item.label} ${item.keywords ?? ""}`.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export function SettingsSidebar({
  org,
  user,
}: {
  org: Org;
  user: SwitcherUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile, setOpen } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  // Which result Enter would open. Reset to the top on every keystroke: the list
  // is rebuilt, so an index into the old one means nothing.
  const [cursor, setCursor] = useState(0);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const workspaceItems = WORKSPACE.filter(
    (it) => !it.multiUserOnly || FEATURE_FLAGS.multiUser,
  );
  const searchResults = [...PERSONAL, ...workspaceItems, ...DANGER].filter((it) =>
    matches(it, terms),
  );

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Drive the result list from the field: the box used to filter with no way to
  // reach what it found without leaving the keyboard for the mouse.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      setCursor(0);
      return;
    }
    if (!searching || searchResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = searchResults[cursor] ?? searchResults[0];
      if (target) {
        router.push(target.href);
        setQuery("");
        setCursor(0);
      }
    }
  }

  function renderItem(it: NavItem, index?: number) {
    const Ic = it.icon;
    const highlighted = searching && index === cursor;
    return (
      <SidebarMenuItem key={it.href}>
        <SidebarMenuButton
          asChild
          isActive={isActive(it.href, it.exact)}
          tooltip={it.label}
          className={cn(
            it.danger && "text-critical hover:text-critical",
            // Mirrors the keyboard cursor for the eye. aria-selected on the link
            // would be a lie (it isn't an option in a listbox), so this is purely
            // visual and Enter is what actually navigates.
            highlighted && "bg-sidebar-accent ring-1 ring-sidebar-ring/40",
          )}
        >
          <Link href={it.href} onClick={() => setQuery("")}>
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
        {/* Back to dashboard is not a settings destination, so it stopped being a
            menu row above Personal and became a control in the header, where the
            other navigation-out affordances live. Stacks in icon mode: the rail
            is one icon wide, and the switcher collapses to its mark on its own. */}
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard"
                aria-label="Back to dashboard"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <ArrowLeftIcon size={16} />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Back to dashboard</TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:w-full">
            <WorkspaceSwitcher org={org} user={user} />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="no-scrollbar">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            {/* Collapsed to icons, the field can't render — but the search still
                has to be reachable, so the icon expands the rail and focuses it
                rather than the search simply vanishing. */}
            {state === "collapsed" && !isMobile ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Search settings"
                    onClick={() => {
                      setOpen(true);
                      // After the rail expands and the input mounts.
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    <MagnifyingGlassIcon />
                    <span>Search settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : (
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  ref={inputRef}
                  placeholder="Search settings…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCursor(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                  className="pl-7"
                  aria-label="Search settings"
                  aria-describedby={searching ? "settings-search-hint" : undefined}
                />
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {searching ? (
          <SidebarGroup>
            <SidebarGroupContent>
              {searchResults.length > 0 ? (
                <>
                  <SidebarMenu>
                    {searchResults.map((it, i) => renderItem(it, i))}
                  </SidebarMenu>
                  <p
                    id="settings-search-hint"
                    aria-live="polite"
                    className="px-2 pt-2 text-meta text-muted-foreground"
                  >
                    {searchResults.length} result{searchResults.length === 1 ? "" : "s"}.
                    Press Enter to open.
                  </p>
                </>
              ) : (
                <p
                  id="settings-search-hint"
                  aria-live="polite"
                  className="px-2 py-1.5 text-dense text-muted-foreground"
                >
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
                <SidebarMenu>{PERSONAL.map((it) => renderItem(it))}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel className="font-normal uppercase tracking-wide">
                Workspace
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{workspaceItems.map((it) => renderItem(it))}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator className="my-1" />
            <SidebarGroup>
              {/* Full opacity, not /80: --critical at 80% measured 4.27:1 on a card in dark
                  theme, under AA for a label this small (`ux:14`). The tier reads as a
                  warning from the hue, not from being faded. */}
              <SidebarGroupLabel className="font-normal uppercase tracking-wide text-critical">
                Danger zone
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{DANGER.map((it) => renderItem(it))}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
