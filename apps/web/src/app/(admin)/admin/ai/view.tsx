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

export function AiView({ data }: { data: AdminAiHealth | null }) {
  const tasks = data?.tasks ?? [];
  const signalsByDay = data?.signalsByDay ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="AI health" subtitle={`Parse/error quality per task. Window: ${data?.window ?? "7d"}.`} />

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
