"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Search,
  Building2,
  FileText,
  Command as CommandIcon,
  LayoutDashboard,
  Radio,
  Activity,
  Sparkles,
  Globe,
  LineChart,
  Columns3,
  Users,
  Box,
  IdCard,
  Settings,
  CreditCard,
  Sun,
  Moon,
  Monitor,
  type LucideIcon,
} from "lucide-react";

import { api, type SearchResults } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const EMPTY: SearchResults = { competitors: [], signals: [], digests: [] };

const SEVERITY_DOT: Record<string, string> = {
  low: "bg-low",
  medium: "bg-medium",
  high: "bg-high",
  critical: "bg-critical",
};

// Navigation targets — mirror the sidebar plus the off-rail pages (battle cards,
// digests, billing) so ⌘K reaches every destination, not just the visible nav.
interface NavCommand {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
}

const NAV: NavCommand[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, keywords: "home dashboard" },
  { href: "/dashboard/signals", label: "Signals", icon: Radio, keywords: "feed alerts" },
  { href: "/dashboard/activity", label: "Activity", icon: Activity, keywords: "scraping runs health" },
  { href: "/dashboard/ask", label: "Ask Outrival", icon: Sparkles, keywords: "ai chat question" },
  { href: "/dashboard/sector", label: "Sector", icon: Globe, keywords: "market overview" },
  { href: "/dashboard/trends", label: "Trends", icon: LineChart, keywords: "charts analytics" },
  { href: "/dashboard/compare", label: "Compare", icon: Columns3, keywords: "side by side" },
  { href: "/dashboard/competitors", label: "Competitors", icon: Users, keywords: "roster companies" },
  { href: "/dashboard/products", label: "Products", icon: Box, keywords: "my product sku" },
  { href: "/dashboard/discovery", label: "Discovery", icon: Search, keywords: "candidates suggestions" },
  { href: "/dashboard/battle-cards", label: "Battle cards", icon: IdCard, keywords: "sales pdf" },
  { href: "/dashboard/digests", label: "Digests", icon: FileText, keywords: "weekly report email" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, keywords: "preferences config" },
  { href: "/dashboard/settings/billing", label: "Billing", icon: CreditCard, keywords: "subscription plan invoice" },
];

const matches = (q: string, ...fields: (string | undefined)[]) =>
  !q || fields.some((f) => f?.toLowerCase().includes(q.toLowerCase()));

export function GlobalSearch() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const searchQ = useQuery({
    queryKey: ["globalSearch", debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2,
  });
  const results: SearchResults = debounced.length >= 2 ? (searchQ.data ?? EMPTY) : EMPTY;
  const loading = debounced.length >= 2 && searchQ.isFetching;

  // ⌘K / Ctrl+K toggles the palette.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounce the query → the search runs via useQuery (results cached per query).
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
    }
  }

  function go(path: string) {
    onOpenChange(false);
    router.push(path);
  }

  function runAction(fn: () => void) {
    onOpenChange(false);
    fn();
  }

  const q = query.trim();
  const navMatches = NAV.filter((n) => matches(q, n.label, n.keywords));
  const THEME_ACTIONS = [
    { id: "theme-dark", label: "Switch to dark theme", icon: Moon, run: () => setTheme("dark"), kw: "theme dark mode" },
    { id: "theme-light", label: "Switch to light theme", icon: Sun, run: () => setTheme("light"), kw: "theme light mode" },
    { id: "theme-system", label: "Match system theme", icon: Monitor, run: () => setTheme("system"), kw: "theme system auto" },
  ];
  const actionMatches = THEME_ACTIONS.filter((a) => matches(q, a.label, a.kw));

  const hasEntities =
    q.length >= 2 &&
    results.competitors.length + results.signals.length + results.digests.length > 0;
  const nothingToShow =
    navMatches.length === 0 &&
    actionMatches.length === 0 &&
    q.length >= 2 &&
    !loading &&
    !hasEntities;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground md:w-80",
          "transition-colors hover:bg-muted hover:text-foreground",
        )}
      >
        <Search size={14} />
        <span className="hidden md:inline">Search…</span>
        <kbd className="hidden md:inline-flex md:ml-auto pointer-events-none h-5 select-none items-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-meta font-medium">
          <CommandIcon className="size-3" />K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="overflow-hidden p-0 shadow-lg">
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search or jump to…"
            />
            <CommandList>
              {/* Commands — always available, filtered by the query (substring on
                  label + keywords). When the input is empty these act as the
                  suggestion list, so the palette is never a dead end. */}
              {navMatches.length > 0 && (
                <CommandGroup heading="Go to">
                  {navMatches.map((n) => {
                    const Icon = n.icon;
                    return (
                      <CommandItem
                        key={n.href}
                        value={`nav-${n.href}`}
                        onSelect={() => go(n.href)}
                      >
                        <Icon className="text-muted-foreground" />
                        <span className="truncate">{n.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {actionMatches.length > 0 && (
                <CommandGroup heading="Actions">
                  {actionMatches.map((a) => {
                    const Icon = a.icon;
                    return (
                      <CommandItem
                        key={a.id}
                        value={`action-${a.id}`}
                        onSelect={() => runAction(a.run)}
                      >
                        <Icon className="text-muted-foreground" />
                        <span className="truncate">{a.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Entity search — only fires at ≥2 chars (server round-trip). */}
              {q.length >= 2 && loading && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Searching…
                </div>
              )}

              {results.competitors.length > 0 && (
                <CommandGroup heading="Competitors">
                  {results.competitors.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`competitor-${c.id}`}
                      onSelect={() => go(`/dashboard/competitors/${c.id}`)}
                    >
                      <Building2 className="text-muted-foreground" />
                      <span className="truncate">{c.name}</span>
                      {c.category && (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {c.category}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.signals.length > 0 && (
                <CommandGroup heading="Signals">
                  {results.signals.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={`signal-${s.id}`}
                      onSelect={() => go(`/dashboard/signals?focus=${s.id}`)}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          SEVERITY_DOT[s.severity] ?? "bg-muted-foreground/50",
                        )}
                      />
                      <span className="truncate">{s.insight}</span>
                      <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                        {s.competitorName}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.digests.length > 0 && (
                <CommandGroup heading="Digests">
                  {results.digests.map((d) => (
                    <CommandItem
                      key={d.id}
                      value={`digest-${d.id}`}
                      onSelect={() => go("/dashboard/digests")}
                    >
                      <FileText className="text-muted-foreground" />
                      <span className="truncate">Week of {d.weekStart}</span>
                      {d.temperature && (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {d.temperature}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {nothingToShow && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No results for “{q}”.
                </div>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
