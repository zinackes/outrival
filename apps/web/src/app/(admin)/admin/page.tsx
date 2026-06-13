import Link from "next/link";
import { adminFetch } from "./_lib/server";
import { PageHeader, Section, Stat, Empty, mono, pctFmt } from "./_components/shell";
import { Badge } from "@/components/ui/badge";
import type {
  AdminOverview,
  AdminScrapingHealth,
  AdminAiHealth,
  AdminDependencies,
  AdminQueueHealth,
} from "@/lib/api";

function HealthTile({
  href,
  label,
  value,
  tone,
  hint,
}: {
  href: string;
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  hint: string;
}) {
  const color =
    tone === "ok"
      ? "var(--positive)"
      : tone === "warn"
        ? "var(--accent)"
        : tone === "bad"
          ? "var(--critical)"
          : "var(--muted)";
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border p-4 transition-colors hover:bg-secondary/50"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold" style={{ ...mono, color }}>
        {value}
      </span>
      <span className="text-meta text-muted-foreground">{hint}</span>
    </Link>
  );
}

export default async function OverviewPage() {
  const [overview, scraping, ai, deps, queue] = await Promise.all([
    adminFetch<AdminOverview>("/api/admin/overview"),
    adminFetch<AdminScrapingHealth>("/api/admin/scraping-health"),
    adminFetch<AdminAiHealth>("/api/admin/ai-health"),
    adminFetch<AdminDependencies>("/api/admin/dependencies"),
    adminFetch<AdminQueueHealth>("/api/admin/queue-health"),
  ]);

  const st = (scraping?.sources ?? []).reduce(
    (a, s) => ({ total: a.total + s.total, failed: a.failed + s.failed }),
    { total: 0, failed: 0 },
  );
  const scrapeFailRate = st.total ? st.failed / st.total : 0;
  const at = (ai?.tasks ?? []).reduce(
    (a, t) => ({ total: a.total + t.total, pf: a.pf + t.parseFailed }),
    { total: 0, pf: 0 },
  );
  const aiParseRate = at.total ? at.pf / at.total : 0;
  const deadCount = scraping?.deadMonitors.length ?? 0;

  const depList = deps?.dependencies ?? [];
  const depsDown = depList.filter((d) => d.status === "down").length;
  const depsDegraded = depList.filter((d) => d.status === "degraded").length;
  const depsTone: "ok" | "warn" | "bad" | "neutral" =
    depsDown > 0 ? "bad" : depsDegraded > 0 ? "warn" : deps ? "ok" : "neutral";
  const depsValue = !deps
    ? "—"
    : depsDown > 0
      ? `${depsDown} down`
      : depsDegraded > 0
        ? `${depsDegraded} degraded`
        : "All OK";
  const backlog = queue?.queues.totalQueued ?? null;
  const overdueCrons = queue?.schedules.overdueCount ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Overview" subtitle="Internal control tower — operator allowlist only." />

      <Section
        title="Platform"
        info="Top-line platform counts: total users, tracked competitors (self excluded), signals over the last 7 days, and the org split by plan."
      >
        {overview ? (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="Users" value={overview.totalUsers} />
            <Stat label="Competitors" value={overview.totalCompetitors} />
            <Stat label="Signals (7d)" value={overview.signals7d} />
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Orgs by plan
              </span>
              <div className="flex flex-wrap gap-1">
                {overview.orgsByPlan.length === 0 ? (
                  <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  overview.orgsByPlan.map((o) => (
                    <Badge key={o.plan} variant="outline" style={mono}>
                      {o.plan}: {o.count}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <Empty>Overview unavailable.</Empty>
        )}
      </Section>

      <Section
        title="System"
        info="Infrastructure health rollup — external dependencies, Trigger.dev queue backlog and overdue crons. Click through for the full breakdown on the System page."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <HealthTile
            href="/admin/system"
            label="Dependencies"
            value={depsValue}
            tone={depsTone}
            hint={deps ? `${depList.length} checked` : "unavailable"}
          />
          <HealthTile
            href="/admin/system"
            label="Queue backlog"
            value={backlog == null ? "—" : String(backlog)}
            tone={backlog == null ? "neutral" : backlog > 50 ? "bad" : "ok"}
            hint="runs queued"
          />
          <HealthTile
            href="/admin/system"
            label="Overdue crons"
            value={queue ? String(overdueCrons) : "—"}
            tone={overdueCrons > 0 ? "bad" : queue ? "ok" : "neutral"}
            hint="schedules past due"
          />
        </div>
      </Section>

      <Section
        title="Health at a glance"
        info="Quick operational health: scrape failure rate (24h), monitors whose latest runs all failed, and AI parse-failure rate (7d). Click a tile for detail."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <HealthTile
            href="/admin/scraping"
            label="Scrape failures (24h)"
            value={st.total ? pctFmt(scrapeFailRate) : "—"}
            tone={scrapeFailRate > 0.3 ? "bad" : st.total ? "ok" : "neutral"}
            hint={`${st.total} runs`}
          />
          <HealthTile
            href="/admin/scraping"
            label="Dead monitors"
            value={String(deadCount)}
            tone={deadCount > 0 ? "bad" : "ok"}
            hint="N latest runs all failed"
          />
          <HealthTile
            href="/admin/ai"
            label="AI parse-fail (7d)"
            value={at.total ? pctFmt(aiParseRate) : "—"}
            tone={aiParseRate > 0.25 ? "bad" : at.total ? "ok" : "neutral"}
            hint={`${at.total} AI runs`}
          />
        </div>
      </Section>
    </div>
  );
}
