"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
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

export function ScrapingView({ data }: { data: AdminScrapingHealth | null }) {
  const sources = data?.sources ?? [];
  const dead = data?.deadMonitors ?? [];
  const failureData = sources.map((s) => ({
    name: s.sourceType,
    failure: Math.round(s.failureRate * 100),
    proxy: Math.round(s.proxyRate * 100),
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Scraping health" subtitle={`Window: ${data?.window ?? "24h"}.`} />

      <Section title="Per source" note={data?.window ?? "24h"}>
        {sources.length === 0 ? (
          <Empty>No scrape runs in the window (ClickHouse empty or unavailable).</Empty>
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
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={failureData}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} />
                  <YAxis stroke="var(--muted)" fontSize={11} unit="%" />
                  <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)" }} />
                  <Bar dataKey="failure" fill="var(--critical)" name="failure %" />
                  <Bar dataKey="proxy" fill="var(--accent)" name="proxy %" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Section>

      <Section title="Cascade levels" note={data?.window ?? "24h"}>
        {(() => {
          const lv = data?.levels;
          const total = lv ? lv.l0 + lv.l1 + lv.l2 + lv.l3 + lv.l4 : 0;
          if (!lv || total === 0) {
            return <Empty>No scrape runs in the window.</Empty>;
          }
          const cells: { label: string; n: number }[] = [
            { label: "L0 direct", n: lv.l0 },
            { label: "L1 browser", n: lv.l1 },
            { label: "L2 datacenter", n: lv.l2 },
            { label: "L3 residential", n: lv.l3 },
            { label: "L4 camoufox", n: lv.l4 },
          ];
          return (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
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

      <Section title="Dead monitors">
        {dead.length === 0 ? (
          <Empty>None — every monitor has a recent success.</Empty>
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
