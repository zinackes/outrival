"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section, Empty, mono, pctFmt } from "../_components/shell";
import { forceScrape } from "../_components/actions";
import type { AdminScrapingHealth } from "@/lib/api";

// recharts is heavy + client-only: lazy-load it off this route's first load (F7).
const FailureBarChart = dynamic(() => import("./scraping-chart"), {
  ssr: false,
  loading: () => <div className="skeleton h-[240px] w-full rounded" />,
});

export function ScrapingView({ data }: { data: AdminScrapingHealth | null }) {
  const sources = data?.sources ?? [];
  const dead = data?.deadMonitors ?? [];
  const refused = data?.refusedDomains ?? [];
  const failureData = sources.map((s) => ({
    name: s.sourceType,
    failure: Math.round(s.failureRate * 100),
    proxy: Math.round(s.proxyRate * 100),
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Scraping health" subtitle={`Window: ${data?.window ?? "24h"}.`} />

      <Section
        title="Per source"
        note={data?.window ?? "24h"}
        info="Scrape runs grouped by source type over the window. Runs = total scrapes; Fail = % that failed; Proxy = % that needed a paid proxy level (L2+); Avg = mean scrape duration."
      >
        {sources.length === 0 ? (
          <Empty>No scrape runs in the window.</Empty>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Fail</TableHead>
                  <TableHead className="text-right">Proxy</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.sourceType}>
                    <TableCell style={mono}>{s.sourceType}</TableCell>
                    <TableCell className="text-right" style={mono}>
                      {s.total}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      style={{ ...mono, color: s.failureRate > 0.3 ? "var(--critical)" : undefined }}
                    >
                      {pctFmt(s.failureRate)}
                    </TableCell>
                    <TableCell className="text-right" style={mono}>
                      {pctFmt(s.proxyRate)}
                    </TableCell>
                    <TableCell className="text-right" style={mono}>
                      {s.avgMs} ms
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <FailureBarChart data={failureData} />
          </div>
        )}
      </Section>

      <Section
        title="Cascade levels"
        note={data?.window ?? "24h"}
        info="Distribution of scrapes across the cascade. L0 direct fetch and L1 browser render are free; L2 uses the paid datacenter egress. Most traffic should stay on L0/L1."
      >
        {(() => {
          const lv = data?.levels;
          const total = lv ? lv.l0 + lv.l1 + lv.l2 : 0;
          if (!lv || total === 0) {
            return <Empty>No scrape runs in the window.</Empty>;
          }
          const cells: { label: string; n: number }[] = [
            { label: "L0 direct", n: lv.l0 },
            { label: "L1 browser", n: lv.l1 },
            { label: "L2 datacenter", n: lv.l2 },
          ];
          return (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {cells.map((c) => (
                <div key={c.label} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  <span style={mono}>{pctFmt(c.n / total)}</span>
                  <span className="text-xs text-muted-foreground" style={mono}>
                    {c.n}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </Section>

      <Section
        title="Refused sources"
        note="7d"
        info="Competitors whose sites refused us (block / challenge / robots Disallow). Under the collection doctrine we stop instead of bypassing. A high refusal rate is a product signal (find another source / accept the gap), not a bug."
      >
        {refused.length === 0 ? (
          <Empty>None. No source has refused us in the last 7 days.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competitor</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Refused</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refused.map((r) => (
                <TableRow key={r.competitorId}>
                  <TableCell>{r.competitorName ?? r.competitorId}</TableCell>
                  <TableCell style={mono}>{r.reason}</TableCell>
                  <TableCell className="text-right" style={mono}>
                    {r.refused}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Extraction resolution"
        note={data?.window ?? "24h"}
        info="How pricing/jobs extractions resolved (patch-30). Structured (schema.org) and cached parser are free; self-heal and AI fallback spend an LLM call. The AI-free share is the direct arbiter of extraction cost: higher is cheaper."
      >
        {(() => {
          const ex = data?.extraction;
          const total = ex ? ex.structured + ex.cache + ex.heal + ex.aiFallback : 0;
          if (!ex || total === 0) {
            return <Empty>No extractions in the window.</Empty>;
          }
          const cells: { label: string; n: number; free: boolean }[] = [
            { label: "Structured", n: ex.structured, free: true },
            { label: "Cached parser", n: ex.cache, free: true },
            { label: "AI self-heal", n: ex.heal, free: false },
            { label: "AI fallback", n: ex.aiFallback, free: false },
          ];
          const aiFree = (ex.structured + ex.cache) / total;
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">AI-free</span>
                <span style={{ ...mono, color: "var(--accent)" }}>{pctFmt(aiFree)}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {cells.map((c) => (
                  <div key={c.label} className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{c.label}</span>
                    <span style={{ ...mono, color: c.free ? undefined : "var(--accent)" }}>
                      {pctFmt(c.n / total)}
                    </span>
                    <span className="text-xs text-muted-foreground" style={mono}>
                      {c.n}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </Section>

      <Section
        title="Cosmetic gate"
        note={data?.window ?? "24h"}
        info="Changes recorded but never classified: the semantic gate judged the underlying fact unchanged (a rewording or reordering). Suppression is invisible to the customer, so this share is the only way to catch the gate drifting from dropping copy passes to eating real signal."
      >
        {(() => {
          const g = data?.cosmeticGate;
          if (!g || g.totalChanges === 0) {
            return <Empty>No changes in the window.</Empty>;
          }
          return (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Suppressed</span>
                <span style={{ ...mono, color: "var(--accent)" }}>
                  {pctFmt(g.suppressed / g.totalChanges)}
                </span>
                <span className="text-xs text-muted-foreground" style={mono}>
                  {g.suppressed}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Classified</span>
                <span style={mono}>
                  {pctFmt((g.totalChanges - g.suppressed) / g.totalChanges)}
                </span>
                <span className="text-xs text-muted-foreground" style={mono}>
                  {g.totalChanges - g.suppressed}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Changes</span>
                <span style={mono}>{g.totalChanges}</span>
              </div>
            </div>
          );
        })()}
      </Section>

      <Section
        title="Dead monitors"
        info="Monitors whose last few scrape runs were all failures, so they're likely permanently broken. Force a scrape to retry one now."
      >
        {dead.length === 0 ? (
          <Empty>None. Every monitor has a recent success.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competitor</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Recent</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dead.map((d) => (
                <TableRow key={d.monitorId}>
                  <TableCell>{d.competitorName ?? d.competitorId.slice(0, 8)}</TableCell>
                  <TableCell style={mono}>{d.sourceType}</TableCell>
                  <TableCell className="text-xs" style={{ ...mono, color: "var(--critical)" }}>
                    {d.recentStatuses.join(" · ")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => forceScrape(d.monitorId)}>
                      Force scrape
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
