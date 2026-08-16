"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Icon as PhosphorIcon } from "@/components/icons";
import {
  SquaresFourIcon,
  BroadcastIcon,
  FileTextIcon,
  PulseIcon,
  ChartLineIcon,
  EyeIcon,
  UsersIcon,
  CubeIcon,
  CardsThreeIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  GearIcon,
  CaretUpDownIcon,
  CreditCardIcon,
  ColumnsIcon,
  SparkleIcon,
} from "@/components/icons";
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
import { ProductTile } from "@/components/dashboard/product-tile";
import { LogoMark } from "@/components/outrival/logo";
import { planIncludesFeature, type PlanFeature } from "@outrival/shared";
import { resolvePlan } from "@/lib/plan";
import { productsListQuery } from "@/lib/queries";
import {
  ALL_PRODUCTS,
  useProductScope,
  useSetProductScope,
} from "@/components/dashboard/product-scope-provider";

export interface Org {
  plan?: string;
  /** Competitors currently watched by the workspace (all products). */
  competitorsUsed?: number;
}

export interface SwitcherUser {
  name: string | null;
  email: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
  exact?: boolean;
  /** Plan feature gating the entry — the item leaves the rail when the plan lacks it. */
  feature?: PlanFeature;
}

// Overview stays ungrouped at the top (the landing); the rest split into three
// job-to-be-done groups, mirroring the grouped settings-sidebar. Scope-aware routes
// read the active product from the cookie (server) / context (client), so plain hrefs
// keep the scope across navigation — no ?product= threading needed.
const OVERVIEW: NavItem = {
  href: "/dashboard",
  label: "Overview",
  icon: SquaresFourIcon,
  exact: true,
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { href: "/dashboard/signals", label: "Signals", icon: BroadcastIcon },
      { href: "/dashboard/digests", label: "Digests", icon: FileTextIcon },
      { href: "/dashboard/activity", label: "Activity", icon: PulseIcon },
    ],
  },
  {
    // Slimmed (page-audit-2026-06-30): Sector is reached from the Overview teaser, so
    // it doesn't earn a rail slot. Trends and Compare stay — real cross-competitor
    // destinations. AI Visibility (docs/ai-visibility.md). Ask came back in
    // (page-audit-2026-08-14): the dock answers in place, but /dashboard/ask is also a
    // page of its own — watched questions and history — and nothing on the rail led
    // there, so that half was reachable only by typing the URL.
    label: "Analyze",
    items: [
      { href: "/dashboard/ask", label: "Ask", icon: SparkleIcon },
      {
        href: "/dashboard/ai-visibility",
        label: "AI Visibility",
        icon: EyeIcon,
        feature: "aiVisibility",
      },
      { href: "/dashboard/trends", label: "Trends", icon: ChartLineIcon },
      { href: "/dashboard/compare", label: "Compare", icon: ColumnsIcon },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/dashboard/competitors", label: "Competitors", icon: UsersIcon },
      { href: "/dashboard/products", label: "Products", icon: CubeIcon },
      { href: "/dashboard/discovery", label: "Discovery", icon: MagnifyingGlassIcon },
    ],
  },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard/settings", label: "Settings", icon: GearIcon },
];

export function WorkspaceSwitcher({
  org,
}: {
  org: Org;
  // Still threaded by AppSidebar; the switcher now leads with the brand mark
  // instead of a per-user avatar, so the value is currently unused.
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
    // Detail page → navigate to the chosen product's page. "All products" now has
    // a page of its own (the portfolio), which is where leaving a product belongs;
    // it used to drop the user on the Overview, a different question entirely.
    if (detailProductId) {
      router.push(next ? `/dashboard/products/${next}` : "/dashboard/products?product=all");
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

  // Mono-product orgs still have one product, and its name is the identity worth
  // reading — the plan is a property of the workspace, not a name. Absent (legacy
  // orgs with no product row, cold cache) the header falls back to "Workspace".
  const soleProduct = selectable[0] ?? null;

  // The workspace has no name of its own (it used to render a fabricated
  // "<first name> workspace"), so what it IS drops to the sub-line: the plan it
  // runs on and how much it watches.
  const planLabel = org.plan
    ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1)
    : null;
  const competitorsLabel =
    org.competitorsUsed != null
      ? `${org.competitorsUsed} competitor${org.competitorsUsed === 1 ? "" : "s"}`
      : null;
  const meta = [planLabel, competitorsLabel].filter(Boolean).join(" · ");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={
                (multiProduct ? activeProduct?.name : soleProduct?.name) ?? "Workspace"
              }
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {/* On a single product the switcher has nothing to disambiguate, so it
                  keeps the brand mark — including on that product's detail page,
                  which sets the scope and used to swap the identity out. Once
                  several products exist and one is the active scope, that product's
                  favicon IS the identity, the same mark it carries everywhere else. */}
              {multiProduct && activeProduct ? (
                <ProductTile
                  name={activeProduct.name}
                  url={activeProduct.url}
                  repoUrl={activeProduct.repoUrl}
                  position={activeProduct.position}
                  size={30}
                  ring
                />
              ) : (
                <LogoMark size={30} />
              )}
              {multiProduct ? (
                // Product is the primary context; plan/coverage drops to the sub-line.
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold inline-flex items-center gap-1">
                    {!activeProduct && (
                      <CardsThreeIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    {activeProduct?.name ?? "All products"}
                  </span>
                  {meta && (
                    <span className="truncate text-meta text-[var(--muted-2)]">
                      {meta}
                    </span>
                  )}
                </div>
              ) : (
                // Same shape as the multi-product branch: the product names the
                // header, plan/coverage sit under it.
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {soleProduct?.name ?? "Workspace"}
                  </span>
                  {meta && (
                    <span className="truncate text-meta text-[var(--muted-2)]">
                      {meta}
                    </span>
                  )}
                </div>
              )}
              <CaretUpDownIcon className="ml-auto size-4 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="w-60"
          >
            {multiProduct && (
              <>
                <DropdownMenuLabel className="text-meta uppercase tracking-wide text-[var(--muted-2)]">
                  Products
                </DropdownMenuLabel>
                {selectable.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => selectProduct(p.id)}
                    className="gap-2"
                  >
                    <ProductTile
                      name={p.name}
                      url={p.url}
                      repoUrl={p.repoUrl}
                      position={p.position}
                      size={16}
                      ring
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    {current === p.id && <CheckIcon className="size-4 shrink-0" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => selectProduct(ALL_PRODUCTS)}
                  className="gap-2"
                >
                  <CardsThreeIcon className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">All products</span>
                  {current === ALL_PRODUCTS && <CheckIcon className="size-4 shrink-0" />}
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="gap-2">
                  <Link href="/dashboard/settings/products">
                    <GearIcon className="size-4" /> Manage products
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">
                <GearIcon className="size-4" /> Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings/billing">
                <CreditCardIcon className="size-4" /> Subscription
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// Nav link with hover/focus data-prefetch. By default Next only prefetches the shell
// (loading.tsx) for these dynamic routes — the page's server data is still fetched at
// click. On the first hover or keyboard focus we upgrade to prefetch={true}, which for a
// dynamic route prefetches the FULL route (server-rendered data included), so the click
// lands on already-warm data instead of waiting a round-trip. Hover-gated so the routes
// don't all render server-side on page load; the router cache holds the warm result
// (staleTimes.static) once fetched.
function NavMenuItem({ item, active }: { item: NavItem; active: boolean }) {
  const [warm, setWarm] = React.useState(false);
  const Ic = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link
          href={item.href}
          prefetch={warm ? true : undefined}
          onMouseEnter={() => setWarm(true)}
          onFocus={() => setWarm(true)}
        >
          <Ic />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ org, user }: { org: Org; user: SwitcherUser }) {
  const pathname = usePathname();
  // The active product scope rides the cookie (read server-side) — plain hrefs keep it
  // across navigation, so the sidebar no longer threads ?product= or reconciles the URL.

  // A plan-gated entry (AI Visibility, pro+) leaves the rail entirely instead of
  // advertising a page the plan can only render as a paywall. Presentation only: the
  // page keeps its own 403-backed lock, so a mid-session downgrade drops the link
  // while whoever is already on the page falls back to the upsell as before.
  const plan = resolvePlan(org.plan);
  const allowed = (items: NavItem[]) =>
    items.filter((it) => !it.feature || planIncludesFeature(plan, it.feature));

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItem(it: NavItem) {
    if (it.href === "/dashboard/competitors") {
      return <SidebarCompetitors key={it.href} />;
    }
    return (
      <NavMenuItem key={it.href} item={it} active={isActive(it.href, it.exact)} />
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
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="font-normal uppercase tracking-wide">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{allowed(group.items).map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
