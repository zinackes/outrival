"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section, Empty, mono, pctFmt } from "../_components/shell";
import type { AdminAiHealth } from "@/lib/api";

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function AiView({ data }: { data: AdminAiHealth | null }) {
  const tasks = data?.tasks ?? [];
  const signalsByDay = data?.signalsByDay ?? [];
  const providers = data?.providers ?? [];
  const breaker = data?.globalBreaker;
  const prediction = data?.prediction;

  const saturationLabel =
    prediction?.hoursToSaturation == null
      ? "no usage yet today"
      : prediction.hoursToSaturation > 48
        ? "plenty of headroom"
        : `~${prediction.hoursToSaturation < 1 ? "<1" : Math.round(prediction.hoursToSaturation)}h at the current rate`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="AI health" subtitle={`Provider pool + parse/error quality per task. Window: ${data?.window ?? "7d"}.`} />

      {breaker?.open && (
        <div className="rounded-md border border-critical/30 bg-critical/8 px-4 py-2.5 text-sm text-foreground">
          🔴 Global circuit breaker OPEN ({breaker.reason ?? "unknown"})
          {breaker.resetInSec != null && ` — resets in ~${Math.ceil(breaker.resetInSec / 60)}min`}. AI generation is paused; scrapes continue.
        </div>
      )}

      <Section
        title="Providers (today)"
        note={
          prediction
            ? `${pctFmt(prediction.usagePct)} of pooled daily quota used · saturation ${saturationLabel}`
            : undefined
        }
      >
        {providers.length === 0 ? (
          <Empty>No providers configured (set AI_PROVIDER_N_* or GROQ_API_KEY).</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Tokens today</TableHead>
                <TableHead className="text-right">Quota %</TableHead>
                <TableHead>Breaker</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell style={mono}>{p.id}</TableCell>
                  <TableCell style={mono}>{p.tier}</TableCell>
                  <TableCell className="text-right" style={mono}>
                    {fmtInt(p.usedTokens)} / {fmtInt(p.dailyTokenQuota)}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    style={{ ...mono, color: p.pct >= 0.95 ? "var(--critical)" : p.pct >= 0.8 ? "var(--high)" : undefined }}
                  >
                    {pctFmt(p.pct)}
                  </TableCell>
                  <TableCell style={{ ...mono, color: p.breaker ? "var(--high)" : undefined }}>
                    {p.breaker ?? "closed"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Per task" note={data?.window ?? "7d"}>
        {tasks.length === 0 ? (
          <Empty>No AI runs in the window.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Parse-fail</TableHead>
                <TableHead className="text-right">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.task}>
                  <TableCell style={mono}>{t.task}</TableCell>
                  <TableCell className="text-right" style={mono}>
                    {t.total}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    style={{ ...mono, color: t.parseFailedRate > 0.25 ? "var(--critical)" : undefined }}
                  >
                    {pctFmt(t.parseFailedRate)}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    style={{ ...mono, color: t.errorRate > 0 ? "var(--high)" : undefined }}
                  >
                    {pctFmt(t.errorRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Signals / day" note="7d">
        {signalsByDay.length === 0 ? (
          <Empty>No signals recorded in the window.</Empty>
        ) : (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={signalsByDay}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="var(--muted)" fontSize={10} />
                <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)" }} />
                <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>
    </div>
  );
}
