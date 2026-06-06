"use client";

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { PageHeader, Section, Stat, Empty, mono, pctFmt, durationFmt } from "../_components/shell";
import type { AdminPlatformDetection } from "@/lib/api";

function TopTable({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; count: number }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{title}</span>
      {rows.length === 0 ? (
        <Empty>None detected.</Empty>
      ) : (
        <Table>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell style={mono}>{r.name}</TableCell>
                <TableCell className="text-right" style={mono}>
                  {r.count}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function PlatformDetectionView({ data }: { data: AdminPlatformDetection | null }) {
  const window = data?.window ?? "7d";
  const a = data?.stages.aStatic ?? 0;
  const b = data?.stages.bBrowser ?? 0;
  const total = a + b;
  const conn = data?.connectors;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Platform detection"
        subtitle={`How competitor stacks are detected (patch-31). Window: ${window}.`}
      />

      <Section
        title="Detection stage"
        note={window}
        info="Step A runs without a browser (cheap); step B falls back to the api-capture browser only when step A is too thin. The browser-free share is the cost arbiter — higher is cheaper, mirror of staged extraction."
      >
        {total === 0 ? (
          <Empty>No detection runs in the window.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Browser-free (step A)</span>
              <span style={{ ...mono, color: "var(--accent)" }}>{pctFmt(a / total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Step A · static</span>
                <span style={mono}>{pctFmt(a / total)}</span>
                <span className="text-xs text-muted-foreground" style={mono}>
                  {a} · {durationFmt(data?.avgMsByStage.aStatic ?? null)}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Step B · browser</span>
                <span style={{ ...mono, color: "var(--accent)" }}>{pctFmt(b / total)}</span>
                <span className="text-xs text-muted-foreground" style={mono}>
                  {b} · {durationFmt(data?.avgMsByStage.bBrowser ?? null)}
                </span>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Connectors detected"
        note={window}
        info="Runs that surfaced a business-ID-bearing connector — these route a source to its structured connector (ATS API, status page, changelog feed, pricing widget) instead of generic scraping."
      >
        {!conn || conn.total === 0 ? (
          <Empty>No detection runs in the window.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="ATS" value={conn.ats} hint={pctFmt(conn.ats / conn.total)} />
            <Stat
              label="Status page"
              value={conn.statusPage}
              hint={pctFmt(conn.statusPage / conn.total)}
            />
            <Stat
              label="Changelog"
              value={conn.changelog}
              hint={pctFmt(conn.changelog / conn.total)}
            />
            <Stat
              label="Pricing widget"
              value={conn.pricingWidget}
              hint={pctFmt(conn.pricingWidget / conn.total)}
            />
          </div>
        )}
      </Section>

      <Section
        title="Top detected"
        note={window}
        info="Most common framework, CMS and ATS values across detection runs in the window."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <TopTable title="Framework" rows={data?.topFrameworks ?? []} />
          <TopTable title="CMS" rows={data?.topCms ?? []} />
          <TopTable title="ATS" rows={data?.topAts ?? []} />
        </div>
      </Section>
    </div>
  );
}
