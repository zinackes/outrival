"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
  Boxes,
  Check,
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
import { UserAvatar } from "@/components/dashboard/user-avatar";
import { productsListQuery } from "@/lib/queries";
import {
  ALL_PRODUCTS,
  useProductScope,
  useSetProductScope,
} from "@/components/dashboard/product-scope-provider";
import { PLAN_LIMITS, planCanReachSectoral, type Plan } from "@outrival/shared";

export interface Org {
  name: string;
  plan?: string;
  seatsUsed?: number;
  seatsLimit?: number;
}

export interface SwitcherUser {
  name: string | null;
  email: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

// Overview stays ungrouped at the top (the landing); the rest split into three
// job-to-be-done groups, mirroring the grouped settings-sidebar. Scope-aware routes
// read the active product from the cookie (server) / context (client), so plain hrefs
// keep the scope across navigation — no ?product= threading needed.
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

export function WorkspaceSwitcher({
  org,
  user,
}: {
  org: Org;
  user: SwitcherUser;
}) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Shares the ["products","list"] cache with the Compare picker / detail pages.
  const productsQ = useQuery(productsListQuery());
  const selectable = (productsQ.data ?? []).filter((p) => p.status !== "archived");
  // Transparent for mono-product orgs: nothing to switch between, so the top-left
  // stays the plain workspace identity (the pre-patch-28 behaviour).
  const multiProduct = selectable.length > 1;

  // On a product detail page (/dashboard/products/:id) the URL [id] is the source of
  // truth — so the switcher navigates between detail pages there. Everywhere else it
  // sets the global cookie-backed scope.
  const detailProductId = pathname.match(/^\/dashboard\/products\/([^/]+)$/)?.[1] ?? null;
  // Effective scope: the URL override (?product=) wins, else the persisted cookie scope.
  const effective = useProductScope();
  const setScope = useSetProductScope();
  const current = detailProductId ?? effective ?? ALL_PRODUCTS;
  const activeProduct = selectable.find((p) => p.id === current) ?? null;

  // Viewing a product's detail page makes it the active scope, so leaving the page
  // (via the sidebar nav) keeps that product selected instead of reverting. setScope
  // only writes the cookie + context (no navigation), so this can't loop.
  React.useEffect(() => {
    if (detailProductId) setScope(detailProductId);
  }, [detailProductId, setScope]);

  function selectProduct(value: string) {
    const next = value === ALL_PRODUCTS ? null : value;
    setScope(next); // persist to cookie + update context (readers react immediately)
    // Detail page → navigate to the chosen product's page (All → overview).
    if (detailProductId) {
      router.push(next ? `/dashboard/products/${next}` : "/dashboard");
      return;
    }
    // Collapse any inbound ?product= override so a stale deep-link param can't fight
    // the new pick; both paths re-run server components, re-seeding with the cookie.
    if (searchParams.has("product")) {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.delete("product");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
    } else {
      router.refresh();
    }
  }

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
              <UserAvatar
                seed={user.email ?? user.name ?? "user"}
                size={32}
              />
              {multiProduct ? (
                // Product is the primary context; org/plan drops to the muted sub-line.
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold inline-flex items-center gap-1">
                    <Boxes className="size-3.5 shrink-0 text-muted-foreground" />
                    {activeProduct?.name ?? "All products"}
                  </span>
                  <span className="truncate text-meta text-[var(--muted-2)]">
                    {org.name}
                    {meta ? ` · ${meta}` : ""}
                  </span>
                </div>
              ) : (
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
              )}
              <ChevronsUpDown className="ml-auto size-4 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="w-60"
          >
            <DropdownMenuLabel className="text-xs text-[var(--muted-2)]">
              {org.name}
              {org.plan ? ` · ${org.plan}` : ""}
            </DropdownMenuLabel>

            {multiProduct && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-meta uppercase tracking-wide text-[var(--muted-2)]">
                  Products
                </DropdownMenuLabel>
                {selectable.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => selectProduct(p.id)}
                    className="gap-2"
                  >
                    <Boxes className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{p.name}</span>
                    {current === p.id && <Check className="size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => selectProduct(ALL_PRODUCTS)}
                  className="gap-2"
                >
                  <Box className="size-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">All products</span>
                  {current === ALL_PRODUCTS && <Check className="size-3.5 shrink-0" />}
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="gap-2">
                  <Link href="/dashboard/settings/products">
                    <Settings className="size-3.5" /> Manage products
                  </Link>
                </DropdownMenuItem>
              </>
            )}

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

export function AppSidebar({ org, user }: { org: Org; user: SwitcherUser }) {
  const pathname = usePathname();
  // The active product scope rides the cookie (read server-side) — plain hrefs keep it
  // across navigation, so the sidebar no longer threads ?product= or reconciles the URL.

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
        <WorkspaceSwitcher org={org} user={user} />
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
