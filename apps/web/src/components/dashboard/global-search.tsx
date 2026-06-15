"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, FileText, Command as CommandIcon } from "lucide-react";

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

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [loading, setLoading] = React.useState(false);

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

  // Debounced server-side search; stale responses are dropped via `active`.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .search(q)
        .then((r) => active && setResults(r))
        .catch(() => active && setResults(EMPTY))
        .finally(() => active && setLoading(false));
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults(EMPTY);
    }
  }

  function go(path: string) {
    onOpenChange(false);
    router.push(path);
  }

  const q = query.trim();
  const hasResults =
    results.competitors.length + results.signals.length + results.digests.length >
    0;

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
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search competitors, signals, digests…"
            />
            <CommandList>
              {q.length < 2 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Type at least 2 characters to search.
                </div>
              ) : loading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Searching…
                </div>
              ) : !hasResults ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No results for “{q}”.
                </div>
              ) : (
                <>
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
                          onSelect={() =>
                            go(`/dashboard/competitors/${s.competitorId}`)
                          }
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
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
