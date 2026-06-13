import { adminFetch } from "../_lib/server";
import { PageHeader, Section, Stat, Empty, usdFmt, bytesFmt, mono } from "../_components/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminCost } from "@/lib/api";

// Sub-cent AI figures are common, so show more precision below $1.
function usdFine(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function tokensFmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export default async function CostPage() {
  const cost = await adminFetch<AdminCost>("/api/admin/cost");

  if (!cost) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Cost" subtitle="Estimates — trends, not accounting." />
        <Section title="Cost">
          <Empty>Cost data unavailable.</Empty>
        </Section>
      </div>
    );
  }

  const hasTokens = cost.ai.tokens30d > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Cost" subtitle="Estimates — trends, not accounting. Tune the constants as real invoices land." />

      <Section
        title="Proxy — ProxyScrape (datacenter + residential)"
        note="estimate"
        info="Estimated proxy cost. Paid scrapes (cascade L2+) carry a fixed monthly datacenter fee; residential (L3+) adds a variable per-scrape cost. Trends, not invoices."
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Paid scrapes (24h)" value={cost.proxy.scrapes24h} />
          <Stat label="Paid scrapes (30d)" value={cost.proxy.scrapes30d} />
          <Stat
            label="≈ 24h"
            value={usdFmt(cost.proxy.estUsd24h)}
            hint={`+ $${cost.proxy.fixedUsdPerMonth}/mo datacenter`}
          />
          <Stat label="≈ 30d" value={usdFmt(cost.proxy.estUsd30d)} />
        </div>
      </Section>

      <Section
        title="AI — token cost"
        note={hasTokens ? "real tokens" : "estimate"}
        info="Cost from actual token usage (ai_runs) × per-model list prices. total_tokens is 0 for runs logged before token attribution shipped, so the dollar figures fill in as new runs accumulate. Calls = volume."
      >
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Calls (24h)" value={cost.ai.calls24h} />
          <Stat label="Tokens (30d)" value={tokensFmt(cost.ai.tokens30d)} />
          <Stat label="≈ 24h" value={usdFine(cost.ai.estUsdReal24h)} />
          <Stat
            label="≈ 30d"
            value={usdFine(cost.ai.estUsdReal30d)}
            hint={`${cost.ai.calls30d} calls`}
          />
        </div>
      </Section>

      <Section
        title="AI cost by task (30d)"
        info="Where the AI budget goes, by task, from real token usage. A multi-call task (e.g. classify + self-check) is summed onto one row; a task running on several models is summed across them."
      >
        {!hasTokens ? (
          <Empty>
            No token data yet — attribution just shipped. This fills in as runs accumulate.
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">≈ 24h</TableHead>
                <TableHead className="text-right">≈ 30d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cost.aiByTask.map((row) => (
                <TableRow key={row.task}>
                  <TableCell>{row.task}</TableCell>
                  <TableCell className="text-right" style={mono}>
                    {row.calls30d}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {tokensFmt(row.tokens30d)}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {usdFine(row.estUsd24h)}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {usdFine(row.estUsd30d)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Storage"
        info="On-disk size of the Postgres database (relational data + analytics). R2 object storage isn't measured (no cheap usage API)."
      >
        <div className="grid grid-cols-2 gap-6">
          <Stat label="Postgres" value={bytesFmt(cost.storage.postgresBytes)} />
          <Stat label="R2" value="n/a" hint="no cheap usage API" />
        </div>
      </Section>
    </div>
  );
}
