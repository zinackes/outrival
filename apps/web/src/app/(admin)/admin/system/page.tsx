import Link from "next/link";
import { adminFetch } from "../_lib/server";
import {
  PageHeader,
  Section,
  Stat,
  Empty,
  StatusPill,
  mono,
  pctFmt,
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
import type {
  AdminQueueHealth,
  AdminDependencies,
  AdminDependency,
  AdminHostHealth,
  AdminErrorRates,
} from "@/lib/api";

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

function gaugeColor(pct: number, warn: number, bad: number): string | undefined {
  if (pct >= bad) return "var(--critical)";
  if (pct >= warn) return "var(--accent)";
  return undefined;
}

function uptimeFmt(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function HostSection({ host }: { host: AdminHostHealth }) {
  return (
    <Section
      title="Host (web + API)"
      note={host.memory.usedPct >= 85 ? "memory high" : undefined}
      info="Resources of the VPS running Next.js (web) and Hono (API). This is NOT scraping — browsers run on Trigger.dev Cloud, so a high backlog is a queue concern, not host RAM. Load is the OS run-queue average; >100% of cores means tasks are waiting on CPU."
    >
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Memory"
          value={
            <span style={{ ...mono, color: gaugeColor(host.memory.usedPct, 70, 85) }}>
              {host.memory.usedPct}%
            </span>
          }
          hint={`${host.memory.usedMb} / ${host.memory.totalMb} MB`}
        />
        <Stat
          label="CPU load"
          value={
            <span style={{ ...mono, color: gaugeColor(host.cpu.loadPctOfCores, 75, 100) }}>
              {host.cpu.loadPctOfCores}%
            </span>
          }
          hint={`${host.cpu.load1} load · ${host.cpu.cores} cores`}
        />
        <Stat label="Load 5/15m" value={`${host.cpu.load5} / ${host.cpu.load15}`} hint="run-queue avg" />
        <Stat label="Uptime" value={uptimeFmt(host.uptimeSec)} hint="process host" />
      </div>
    </Section>
  );
}

// A 1h failure rate well above the 24h baseline is a spike worth flagging.
function spiking(h1Rate: number, h1Total: number, h24Rate: number): boolean {
  return h1Total >= 5 && h1Rate > 0.25 && h1Rate > h24Rate * 1.5;
}

function ErrorsSection({ rates }: { rates: AdminErrorRates }) {
  const aiSpike = spiking(rates.ai.h1.failureRate, rates.ai.h1.total, rates.ai.h24.failureRate);
  const scrapeSpike = spiking(rates.scrape.h1.failureRate, rates.scrape.h1.total, rates.scrape.h24.failureRate);
  const rateValue = (r: number, total: number, warn: boolean) => (
    <span style={{ ...mono, color: warn ? "var(--critical)" : undefined }}>
      {total > 0 ? pctFmt(r) : "—"}
    </span>
  );
  return (
    <Section
      title="Errors"
      note={aiSpike || scrapeSpike ? "spike" : undefined}
      info="Failure rate over the last hour next to the 24h baseline — a 1h rate well above baseline is a spike. AI = error + parse_failed over ai_runs; scrape = failed runs. Exceptions themselves are captured in Sentry (prod); see the AI / Scraping pages for the per-task breakdown."
      action={
        <Link
          href="/admin/ai"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          AI detail →
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="AI fail (1h)"
          value={rateValue(rates.ai.h1.failureRate, rates.ai.h1.total, aiSpike)}
          hint={`${rates.ai.h1.errors + rates.ai.h1.parseFailed} / ${rates.ai.h1.total} runs`}
        />
        <Stat
          label="AI fail (24h)"
          value={rateValue(rates.ai.h24.failureRate, rates.ai.h24.total, false)}
          hint={`${rates.ai.h24.errors + rates.ai.h24.parseFailed} / ${rates.ai.h24.total} runs`}
        />
        <Stat
          label="Scrape fail (1h)"
          value={rateValue(rates.scrape.h1.failureRate, rates.scrape.h1.total, scrapeSpike)}
          hint={`${rates.scrape.h1.failed} / ${rates.scrape.h1.total} runs`}
        />
        <Stat
          label="Scrape fail (24h)"
          value={rateValue(rates.scrape.h24.failureRate, rates.scrape.h24.total, false)}
          hint={`${rates.scrape.h24.failed} / ${rates.scrape.h24.total} runs`}
        />
      </div>
    </Section>
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
  const [health, deps, host, rates] = await Promise.all([
    adminFetch<AdminQueueHealth>("/api/admin/queue-health"),
    adminFetch<AdminDependencies>("/api/admin/dependencies"),
    adminFetch<AdminHostHealth>("/api/admin/host-health"),
    adminFetch<AdminErrorRates>("/api/admin/error-rates"),
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

      {host ? <HostSection host={host} /> : null}

      {rates ? <ErrorsSection rates={rates} /> : null}

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
