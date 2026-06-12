import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "./info-hint";

export const mono = { fontFamily: "var(--font-mono)" } as const;

// --- formatters (pure) ---
export function pctFmt(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
export function usdFmt(n: number): string {
  return `$${n.toFixed(2)}`;
}
export function centsFmt(c: number | null): string {
  return c == null ? "—" : `$${(c / 100).toFixed(c < 100 ? 4 : 2)}`;
}
export function bytesFmt(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
export function durationFmt(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
export function dateFmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
export function relativeFmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = Date.now() - d;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// --- presentational ---
export function Section({
  title,
  note,
  info,
  action,
  children,
}: {
  title: string;
  note?: string;
  info?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          {note ? (
            <Badge variant="outline" className="text-meta font-normal text-muted-foreground">
              {note}
            </Badge>
          ) : null}
          {info ? <InfoHint text={info} /> : null}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold" style={mono}>
        {value}
      </span>
      {hint ? <span className="text-meta text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-1">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

// Color a status label by family (Trigger.dev run statuses + scrape/feedback).
const GREEN = new Set(["COMPLETED", "success", "resolved", "added"]);
const RED = new Set(["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "failed"]);
const AMBER = new Set(["EXECUTING", "REATTEMPTING", "no_change", "reviewed", "parse_failed"]);
const MUTED = new Set(["QUEUED", "WAITING", "DELAYED", "PENDING", "CANCELED", "CANCELLED", "EXPIRED", "new"]);

export function StatusPill({ status }: { status: string }) {
  const color = GREEN.has(status)
    ? "var(--positive)"
    : RED.has(status)
      ? "var(--critical)"
      : AMBER.has(status)
        ? "var(--accent)"
        : MUTED.has(status)
          ? "var(--muted)"
          : "var(--muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-meta"
      style={{ borderColor: "var(--border)", color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span style={mono}>{status}</span>
    </span>
  );
}
