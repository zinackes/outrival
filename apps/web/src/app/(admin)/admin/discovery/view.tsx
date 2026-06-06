"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PageHeader,
  Section,
  Stat,
  Empty,
  StatusPill,
  mono,
  pctFmt,
  relativeFmt,
} from "../_components/shell";
import type { AdminDiscovery } from "@/lib/api";

export function DiscoveryView({ data }: { data: AdminDiscovery | null }) {
  const c = data?.candidates;
  const bySource = data?.bySource ?? [];
  const recent = data?.recent ?? [];
  const days = data?.windowDays ?? 30;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Discovery"
        subtitle="Exa competitor suggestions: are they good enough to accept, and what do on-demand runs cost?"
      />

      <Section
        title="Candidates"
        note={`${days}d`}
        info="Competitor candidates first seen in the window. Acceptance = added / (added + dismissed) — the quality of the Exa + overlap-scoring suggestions. Avg overlap is the mean 0–100 overlap score."
      >
        {!c || c.total === 0 ? (
          <Empty>No candidates in the window.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
            <Stat label="Total" value={c.total} />
            <Stat label="New" value={c.new} hint="undecided" />
            <Stat label="Added" value={c.added} />
            <Stat label="Acceptance" value={pctFmt(c.acceptanceRate)} hint="of decided" />
            <Stat label="Avg overlap" value={c.avgOverlap} hint="0–100" />
          </div>
        )}
      </Section>

      <Section
        title="By source"
        note={`${days}d`}
        info="Candidates split by where they came from: the weekly Exa detection cron vs saved from the onboarding discovery step."
      >
        {bySource.length === 0 ? (
          <Empty>No candidates in the window.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Dismissed</TableHead>
                <TableHead className="text-right">Acceptance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bySource.map((s) => (
                <TableRow key={s.source}>
                  <TableCell style={mono}>{s.source}</TableCell>
                  <TableCell className="text-right" style={mono}>
                    {s.total}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {s.added}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {s.dismissed}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {pctFmt(s.acceptanceRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="On-demand discovery"
        note={data?.discovery.month ?? ""}
        info="The /detect on-demand runs consumed this calendar month (the variable Exa cost). Active orgs = orgs that triggered at least one run this month."
      >
        <div className="grid grid-cols-2 gap-5">
          <Stat label="Runs this month" value={data?.discovery.detectThisMonth ?? 0} />
          <Stat label="Active orgs" value={data?.discovery.activeOrgs ?? 0} />
        </div>
      </Section>

      <Section title="Recent candidates" info="The 15 most recently seen candidates across all orgs.">
        {recent.length === 0 ? (
          <Empty>No candidates yet.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead className="text-right">Overlap</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((r) => (
                <TableRow key={r.url}>
                  <TableCell className="text-xs text-muted-foreground" style={mono}>
                    {relativeFmt(r.firstSeenAt)}
                  </TableCell>
                  <TableCell className="max-w-[320px] truncate" title={r.url}>
                    {r.title ?? r.url}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {r.overlapScore ?? "—"}
                  </TableCell>
                  <TableCell style={mono}>{r.source}</TableCell>
                  <TableCell>
                    <StatusPill status={r.status} />
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
