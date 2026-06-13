import Link from "next/link";
import { adminFetch } from "../_lib/server";
import {
  PageHeader,
  Section,
  Stat,
  Empty,
  StatusPill,
  mono,
  durationFmt,
  relativeFmt,
  dateFmt,
} from "../_components/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AdminQueueHealth, AdminDependencies, AdminDependency } from "@/lib/api";

// Backlog over this many queued runs is worth flagging (scraping fans out, so a
// little queueing is normal; a standing backlog means capacity is short).
const BACKLOG_WARN = 50;

function emphasize(value: number, warn: boolean): React.CSSProperties {
  return { ...mono, color: warn && value > 0 ? "var(--critical)" : undefined };
}

const DEP_COLOR: Record<AdminDependency["status"], string> = {
  ok: "var(--positive)",
  degraded: "var(--accent)",
  down: "var(--critical)",
  skipped: "var(--muted)",
};

function DependencyPill({ dep }: { dep: AdminDependency }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
      title={dep.detail ?? undefined}
    >
      <span className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 rounded-full" style={{ background: DEP_COLOR[dep.status] }} />
        <span className="capitalize">{dep.name}</span>
      </span>
      <span className="text-meta text-muted-foreground" style={mono}>
        {dep.status === "skipped"
          ? "n/a"
          : dep.latencyMs != null
            ? `${dep.latencyMs}ms`
            : dep.status}
      </span>
    </div>
  );
}

function TriggerSections({ health }: { health: AdminQueueHealth }) {
  const { queues, failures24h, throughput24h, schedules } = health;
  const activeQueues = queues.rows.filter((q) => q.queued > 0 || q.running > 0 || q.paused);
  const backlogWarn = queues.totalQueued > BACKLOG_WARN;

  return (
    <>
      <Section
        title="Trigger.dev queue"
        note={backlogWarn ? "backlog" : undefined}
        info="Aggregate queue state from Trigger.dev Cloud. Backlog (queued) is the real 'scale me' signal — a standing backlog means jobs are waiting for a worker slot. Running = currently executing. Avg run / failures are over the last 24h."
      >
        {queues.available || throughput24h.available || failures24h.available ? (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat
              label="Queued"
              value={
                <span style={emphasize(queues.totalQueued, backlogWarn)}>
                  {queues.available ? queues.totalQueued : "—"}
                </span>
              }
              hint="backlog"
            />
            <Stat label="Running" value={queues.available ? queues.totalRunning : "—"} hint="executing now" />
            <Stat
              label="Failures (24h)"
              value={
                <span style={emphasize(failures24h.count, failures24h.count > 0)}>
                  {failures24h.available ? `${failures24h.count}${failures24h.capped ? "+" : ""}` : "—"}
                </span>
              }
              hint="failed / crashed runs"
            />
            <Stat
              label="Avg run (24h)"
              value={throughput24h.available ? durationFmt(throughput24h.avgDurationMs) : "—"}
              hint={throughput24h.available ? `${throughput24h.sampled} sampled` : undefined}
            />
          </div>
        ) : (
          <Empty>Queue metrics unavailable.</Empty>
        )}
      </Section>

      <Section
        title="Queues"
        info="Per-queue backlog and concurrency. A queue whose running count sits at its concurrency limit while queued grows is the bottleneck — raise its concurrency or the worker capacity."
      >
        {!queues.available ? (
          <Empty>Queue list unavailable.</Empty>
        ) : activeQueues.length === 0 ? (
          <Empty>All queues idle.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Queued</TableHead>
                <TableHead className="text-right">Running</TableHead>
                <TableHead className="text-right">Concurrency</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeQueues.map((q) => {
                const saturated =
                  q.concurrencyLimit != null && q.running >= q.concurrencyLimit && q.queued > 0;
                return (
                  <TableRow key={`${q.type}/${q.name}`}>
                    <TableCell style={mono}>
                      {q.name}
                      <span className="ml-1 text-meta text-muted-foreground">({q.type})</span>
                    </TableCell>
                    <TableCell className="text-right" style={emphasize(q.queued, q.queued > 0)}>
                      {q.queued}
                    </TableCell>
                    <TableCell className="text-right" style={mono}>
                      {q.running}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      style={{ ...mono, color: saturated ? "var(--accent)" : undefined }}
                    >
                      {q.concurrencyLimit ?? "∞"}
                    </TableCell>
                    <TableCell className="text-right">
                      {q.paused ? (
                        <Badge variant="outline" className="text-meta text-muted-foreground">
                          paused
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Scheduled jobs"
        note={schedules.overdueCount > 0 ? `${schedules.overdueCount} overdue` : undefined}
        info="Registered Trigger.dev cron schedules with their next fire time. An inactive schedule that should be running, or one whose next run is already in the past, is a silent scheduler stall."
      >
        {!schedules.available ? (
          <Empty>Schedule list unavailable.</Empty>
        ) : schedules.rows.length === 0 ? (
          <Empty>No registered schedules.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Cron</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell style={mono}>{s.task}</TableCell>
                  <TableCell className="text-xs text-muted-foreground" style={mono}>
                    {s.cron}
                    <span className="ml-1 text-meta">{s.timezone}</span>
                  </TableCell>
                  <TableCell
                    className="text-xs"
                    title={dateFmt(s.nextRun)}
                    style={{ color: s.overdue ? "var(--critical)" : "var(--muted-foreground)" }}
                  >
                    {s.active ? relativeFmt(s.nextRun) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!s.active ? (
                      <Badge variant="outline" className="text-meta text-muted-foreground">
                        inactive
                      </Badge>
                    ) : s.overdue ? (
                      <Badge
                        variant="outline"
                        className="text-meta"
                        style={{ color: "var(--critical)", borderColor: "var(--critical)" }}
                      >
                        overdue
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Recent failures (24h)"
        info="The latest failed, crashed, timed-out or system-failure runs. Inspect a run on the Jobs page for its error and payload."
        action={
          <Link
            href="/admin/jobs"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            All runs →
          </Link>
        }
      >
        {!failures24h.available ? (
          <Empty>Run history unavailable.</Empty>
        ) : failures24h.rows.length === 0 ? (
          <Empty>No failed runs in the last 24h.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures24h.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell style={mono}>{r.taskIdentifier}</TableCell>
                  <TableCell>
                    <StatusPill status={r.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground" title={dateFmt(r.createdAt)}>
                    {relativeFmt(r.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}

export default async function SystemPage() {
  const [health, deps] = await Promise.all([
    adminFetch<AdminQueueHealth>("/api/admin/queue-health"),
    adminFetch<AdminDependencies>("/api/admin/dependencies"),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="System"
        subtitle="Infrastructure health — external dependencies, Trigger.dev queue & cron. The real scraping capacity lives on Trigger.dev Cloud, not the VPS."
      />

      <Section
        title="Dependencies"
        note={deps ? undefined : "unavailable"}
        info="Liveness of each external brick the platform depends on, probed server-side with a 3s timeout and cached ~30s. Latency is the round-trip; 'n/a' means not configured in this environment."
      >
        {deps && deps.dependencies.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {deps.dependencies.map((d) => (
              <DependencyPill key={d.name} dep={d} />
            ))}
          </div>
        ) : (
          <Empty>Dependency health unavailable.</Empty>
        )}
      </Section>

      {!health ? (
        <Section title="Trigger.dev">
          <Empty>Trigger.dev queue & cron health unavailable.</Empty>
        </Section>
      ) : !health.configured ? (
        <Section title="Trigger.dev">
          <Empty>Trigger.dev not configured (TRIGGER_SECRET_KEY missing).</Empty>
        </Section>
      ) : (
        <TriggerSections health={health} />
      )}
    </div>
  );
}
