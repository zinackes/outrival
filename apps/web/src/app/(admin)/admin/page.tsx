import Link from "next/link";
import { adminFetch } from "./_lib/server";
import { PageHeader, Section, Stat, Empty, mono, pctFmt } from "./_components/shell";
import { Badge } from "@/components/ui/badge";
import type { AdminOverview, AdminScrapingHealth, AdminAiHealth } from "@/lib/api";

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
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </Link>
  );
}

export default async function OverviewPage() {
  const [overview, scraping, ai] = await Promise.all([
    adminFetch<AdminOverview>("/api/admin/overview"),
    adminFetch<AdminScrapingHealth>("/api/admin/scraping-health"),
    adminFetch<AdminAiHealth>("/api/admin/ai-health"),
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Overview" subtitle="Internal control tower — operator allowlist only." />

      <Section title="Platform">
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

      <Section title="Health at a glance">
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
