"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Icon as PhosphorIcon } from "@/components/icons";
import {
  SquaresFourIcon,
  PulseIcon,
  BrainIcon,
  ListChecksIcon,
  UsersIcon,
  RocketIcon,
  ChatIcon,
  ThumbsUpIcon,
  ShieldWarningIcon,
  CurrencyDollarIcon,
  ScrollIcon,
  PlugsIcon,
  BellRingingIcon,
  GaugeIcon,
  CardsThreeIcon,
  TreeStructureIcon,
  PaperPlaneTiltIcon,
  BinocularsIcon,
  SparkleIcon,
  HeartbeatIcon,
  TrendUpIcon,
  ChartLineIcon,
} from "@/components/icons";

type NavItem = { href: string; label: string; icon: PhosphorIcon };
type NavSection = { title?: string; items: NavItem[] };

// Grouped by domain so the flat 21-item list reads as sections (Control /
// Scraping / AI / Delivery / Growth / Support). The first group is unlabeled —
// it's the control tower. Cost sits under AI (it's mostly AI/proxy spend).
const SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/admin", label: "Overview", icon: SquaresFourIcon },
      { href: "/admin/system", label: "System", icon: HeartbeatIcon },
      { href: "/admin/jobs", label: "Jobs", icon: ListChecksIcon },
    ],
  },
  {
    title: "Scraping",
    items: [
      { href: "/admin/scraping", label: "Scraping", icon: PulseIcon },
      { href: "/admin/monitors-health", label: "Monitors health", icon: GaugeIcon },
      { href: "/admin/scraping-edge-cases", label: "Edge cases", icon: PlugsIcon },
      { href: "/admin/platform-detection", label: "Platform", icon: TreeStructureIcon },
      { href: "/admin/enrichment", label: "Enrichment", icon: SparkleIcon },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/admin/ai", label: "AI", icon: BrainIcon },
      { href: "/admin/feedback-quality", label: "AI quality", icon: ThumbsUpIcon },
      { href: "/admin/ai-review-queue", label: "AI review", icon: ShieldWarningIcon },
      { href: "/admin/cost", label: "Cost", icon: CurrencyDollarIcon },
    ],
  },
  {
    title: "Delivery",
    items: [
      { href: "/admin/notification-moderation", label: "Notifications", icon: BellRingingIcon },
      { href: "/admin/delivery", label: "Delivery", icon: PaperPlaneTiltIcon },
    ],
  },
  {
    title: "Growth",
    items: [
      { href: "/admin/onboarding", label: "Onboarding", icon: RocketIcon },
      { href: "/admin/discovery", label: "Discovery", icon: BinocularsIcon },
      { href: "/admin/multi-product", label: "Products", icon: CardsThreeIcon },
      { href: "/admin/business", label: "Business", icon: TrendUpIcon },
      { href: "/admin/product", label: "Product KPIs", icon: ChartLineIcon },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/admin/users", label: "Users", icon: UsersIcon },
      { href: "/admin/feedback", label: "Feedback", icon: ChatIcon },
      { href: "/admin/audit", label: "Audit", icon: ScrollIcon },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-3">
      {SECTIONS.map((section, i) => (
        <div key={section.title ?? `group-${i}`} className="flex flex-col gap-0.5">
          {section.title ? (
            <span className="px-3 pb-1 text-meta font-medium uppercase tracking-wide text-muted-foreground">
              {section.title}
            </span>
          ) : null}
          {section.items.map(({ href, label, icon: Icon }) => {
            // /admin matches exactly; sub-routes match the exact path or a deeper
            // segment (the trailing slash keeps /scraping from matching
            // /scraping-edge-cases).
            const active =
              href === "/admin"
                ? pathname === "/admin"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
