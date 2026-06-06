"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section, Stat, Empty, mono, pctFmt, relativeFmt } from "../_components/shell";
import type { AdminDelivery } from "@/lib/api";

export function DeliveryView({ data }: { data: AdminDelivery | null }) {
  const channels = data?.alerts.byChannel ?? [];
  const failures = data?.alerts.recentFailures ?? [];
  const dig = data?.digests;
  const alertDays = data?.alerts.windowDays ?? 7;
  const digestDays = dig?.windowDays ?? 30;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Delivery"
        subtitle="Did alerts and digests actually reach users? Failed sends are otherwise invisible."
      />

      <Section
        title="Alerts by channel"
        note={`${alertDays}d`}
        info="Real-time alert sends grouped by channel. Sent = delivered cleanly; Fail = the send threw (alerts.error). A non-zero fail rate means users are silently missing critical alerts."
      >
        {channels.length === 0 ? (
          <Empty>No alerts in the window.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Fail rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((ch) => (
                <TableRow key={ch.channel}>
                  <TableCell style={mono}>{ch.channel}</TableCell>
                  <TableCell className="text-right" style={mono}>
                    {ch.total}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {ch.sent}
                  </TableCell>
                  <TableCell className="text-right" style={mono}>
                    {ch.failed}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    style={{ ...mono, color: ch.failRate > 0.1 ? "var(--critical)" : undefined }}
                  >
                    {pctFmt(ch.failRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Recent send failures"
        info="The 20 most recent alerts whose send threw an error. Empty is the healthy state."
      >
        {failures.length === 0 ? (
          <Empty>None — every alert in the window sent cleanly.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Org</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs text-muted-foreground" style={mono}>
                    {relativeFmt(f.createdAt)}
                  </TableCell>
                  <TableCell>{f.orgName ?? "—"}</TableCell>
                  <TableCell style={mono}>{f.channel}</TableCell>
                  <TableCell
                    className="max-w-[420px] truncate text-xs"
                    style={{ ...mono, color: "var(--critical)" }}
                    title={f.error ?? undefined}
                  >
                    {f.error ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Weekly digests"
        note={`${digestDays}d`}
        info="Digest rows generated in the window and whether they were emailed (digests.sent_at). Unsent = generated but never delivered."
      >
        {!dig || dig.generated === 0 ? (
          <Empty>No digests in the window.</Empty>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-5">
              <Stat label="Generated" value={dig.generated} />
              <Stat label="Sent" value={dig.sent} hint={pctFmt(dig.sent / dig.generated)} />
              <Stat
                label="Unsent"
                value={dig.unsent}
                hint={dig.unsent > 0 ? "delivery gap" : "all delivered"}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(["low", "moderate", "high", "unknown"] as const).map((k) => (
                <div key={k} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground capitalize">{k}</span>
                  <span style={mono}>{dig.temperature[k]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
