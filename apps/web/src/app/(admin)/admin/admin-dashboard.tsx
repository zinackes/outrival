"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type {
  AdminOverview,
  AdminScrapingHealth,
  AdminAiHealth,
  AdminCost,
  AdminFeedbackRow,
  AdminFeedbackStatus,
  AdminAuditEntry,
  AdminUserRow,
  AdminUserDetail,
} from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const mono = { fontFamily: "var(--font-mono)" } as const;

function pctFmt(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function usdFmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

function bytesFmt(n: number | null): string {
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

function dateFmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold" style={mono}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          {note ? (
            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
              {note}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}

async function forceScrape(monitorId: string) {
  try {
    await api.adminForceScrape(monitorId);
    toast.success("Scrape triggered", { description: `Monitor ${monitorId.slice(0, 8)}…` });
  } catch {
    toast.error("Could not trigger scrape");
  }
}

// --- Feedback section (status changes + screenshot viewer) ---
function FeedbackSection({ initial }: { initial: AdminFeedbackRow[] }) {
  const [rows, setRows] = useState(initial);
  const [shot, setShot] = useState<{ url: string; id: string } | null>(null);
  const [loadingShot, setLoadingShot] = useState(false);

  async function setStatus(id: string, status: AdminFeedbackStatus) {
    try {
      await api.adminUpdateFeedback(id, status);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      toast.success(`Marked ${status}`);
    } catch {
      toast.error("Update failed");
    }
  }

  async function viewShot(id: string) {
    setLoadingShot(true);
    try {
      const res = await fetch(`${API}/api/admin/feedback/${id}/screenshot`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("not found");
      const blob = await res.blob();
      setShot({ url: URL.createObjectURL(blob), id });
    } catch {
      toast.error("No screenshot available");
    } finally {
      setLoadingShot(false);
    }
  }

  if (rows.length === 0) return <Empty>No feedback yet.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((f) => (
        <div key={f.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{f.type}</Badge>
            <span style={mono}>{f.userEmail ?? "unknown"}</span>
            <span>·</span>
            <span>{dateFmt(f.createdAt)}</span>
            {f.pageUrl ? (
              <>
                <span>·</span>
                <span className="truncate" style={mono}>
                  {f.pageUrl}
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{f.message}</p>

          {f.consoleErrors && f.consoleErrors.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {f.consoleErrors.length} console error(s)
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-secondary p-2 text-[11px]" style={mono}>
                {f.consoleErrors.map((e) => e.message).join("\n")}
              </pre>
            </details>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <Select value={f.status} onValueChange={(v) => setStatus(f.id, v as AdminFeedbackStatus)}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">new</SelectItem>
                <SelectItem value="reviewed">reviewed</SelectItem>
                <SelectItem value="resolved">resolved</SelectItem>
              </SelectContent>
            </Select>
            {f.screenshotR2Key ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={loadingShot}
                onClick={() => viewShot(f.id)}
              >
                Screenshot
              </Button>
            ) : null}
          </div>
        </div>
      ))}

      <Dialog open={!!shot} onOpenChange={(o) => !o && setShot(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Feedback screenshot</DialogTitle>
          </DialogHeader>
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="feedback screenshot" className="max-h-[70vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- User debug section (search + detail + force scrape) ---
function UserDebugSection() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AdminUserRow[] | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      const res = await api.adminSearchUsers(q.trim());
      setResults(res.users);
      setDetail(null);
    } catch {
      toast.error("Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setBusy(true);
    try {
      setDetail(await api.adminGetUser(id));
    } catch {
      toast.error("Could not load user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input
          placeholder="Search by email, name or org…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9"
        />
        <Button type="submit" disabled={busy} className="h-9">
          Search
        </Button>
      </form>

      {results && !detail ? (
        results.length === 0 ? (
          <Empty>No users match.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Org</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell style={mono}>{u.email}</TableCell>
                  <TableCell>{u.orgName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{u.plan ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => open(u.userId)}>
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {detail ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="font-medium" style={mono}>
                {detail.user.email}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {detail.org?.name ?? "no org"} · {detail.org?.plan ?? "—"}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
              ← Back
            </Button>
          </div>

          {detail.competitors.length === 0 ? (
            <Empty>No competitors.</Empty>
          ) : (
            detail.competitors.map((comp) => (
              <div key={comp.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="font-medium">{comp.name}</span>
                  {comp.type === "self" ? <Badge variant="outline">self</Badge> : null}
                  {comp.url ? (
                    <span className="truncate text-xs text-muted-foreground" style={mono}>
                      {comp.url}
                    </span>
                  ) : null}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comp.monitors.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell style={mono}>
                          {m.sourceType}
                          {m.requiresProxy ? " 🛡" : ""}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {dateFmt(m.lastRunAt)}
                        </TableCell>
                        <TableCell>
                          {m.lastFailedAt ? (
                            <span style={{ color: "var(--critical)" }}>failed</span>
                          ) : m.isActive ? (
                            <span style={{ color: "var(--positive)" }}>active</span>
                          ) : (
                            <span className="text-muted-foreground">paused</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => forceScrape(m.id)}>
                            Force scrape
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AdminDashboard({
  overview,
  scraping,
  ai,
  cost,
  feedback,
  audit,
}: {
  overview: AdminOverview | null;
  scraping: AdminScrapingHealth | null;
  ai: AdminAiHealth | null;
  cost: AdminCost | null;
  feedback: AdminFeedbackRow[];
  audit: AdminAuditEntry[];
}) {
  const failureData =
    scraping?.sources.map((s) => ({
      name: s.sourceType,
      failure: Math.round(s.failureRate * 100),
    })) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Admin ops</h1>
            <p className="text-sm text-muted-foreground">
              Internal control tower — operator allowlist only.
            </p>
          </div>
        </header>

        {/* 1. Overview */}
        <Section title="Overview">
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

        {/* 2. Scraping health */}
        <Section title="Scraping health" note={scraping?.window ?? "24h"}>
          {scraping && scraping.sources.length > 0 ? (
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Fail</TableHead>
                      <TableHead className="text-right">Proxy</TableHead>
                      <TableHead className="text-right">Avg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scraping.sources.map((s) => (
                      <TableRow key={s.sourceType}>
                        <TableCell style={mono}>{s.sourceType}</TableCell>
                        <TableCell className="text-right" style={mono}>
                          {s.total}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          style={{ ...mono, color: s.failureRate > 0.3 ? "var(--critical)" : undefined }}
                        >
                          {pctFmt(s.failureRate)}
                        </TableCell>
                        <TableCell className="text-right" style={mono}>
                          {pctFmt(s.proxyRate)}
                        </TableCell>
                        <TableCell className="text-right" style={mono}>
                          {s.avgMs} ms
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={failureData}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} />
                      <YAxis stroke="var(--muted)" fontSize={11} unit="%" />
                      <Tooltip
                        contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                      />
                      <Bar dataKey="failure" fill="var(--critical)" name="failure %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Dead monitors</h3>
                {scraping.deadMonitors.length === 0 ? (
                  <Empty>None — every monitor has a recent success.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Competitor</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Recent</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scraping.deadMonitors.map((d) => (
                        <TableRow key={d.monitorId}>
                          <TableCell>{d.competitorName ?? d.competitorId.slice(0, 8)}</TableCell>
                          <TableCell style={mono}>{d.sourceType}</TableCell>
                          <TableCell className="text-xs" style={{ ...mono, color: "var(--critical)" }}>
                            {d.recentStatuses.join(" · ")}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => forceScrape(d.monitorId)}>
                              Force scrape
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          ) : (
            <Empty>No scrape runs in the window (ClickHouse empty or unavailable).</Empty>
          )}
        </Section>

        {/* 3. AI health */}
        <Section title="AI health" note={ai?.window ?? "7d"}>
          {ai ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {ai.tasks.length > 0 ? (
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
                    {ai.tasks.map((t) => (
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
              ) : (
                <Empty>No AI runs in the window.</Empty>
              )}
              <div className="h-[220px]">
                <h3 className="mb-2 text-sm font-medium">Signals / day</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={ai.signalsByDay}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="day" stroke="var(--muted)" fontSize={10} />
                    <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                    />
                    <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <Empty>AI health unavailable.</Empty>
          )}
        </Section>

        {/* 4. Cost */}
        <Section title="Cost" note="estimates — trends, not accounting">
          {cost ? (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Stat label="Proxy scrapes (24h)" value={cost.proxy.scrapes24h} />
              <Stat label="Proxy ≈ (30d)" value={usdFmt(cost.proxy.estUsd30d)} />
              <Stat label="AI calls (24h)" value={cost.ai.calls24h} />
              <Stat label="AI ≈ (30d)" value={usdFmt(cost.ai.estUsd30d)} />
              <Stat label="Postgres" value={bytesFmt(cost.storage.postgresBytes)} />
              <Stat label="ClickHouse" value={bytesFmt(cost.storage.clickhouseBytes)} />
              <Stat label="R2" value="n/a" />
            </div>
          ) : (
            <Empty>Cost data unavailable.</Empty>
          )}
        </Section>

        {/* 5. Feedback */}
        <Section title="Feedback">
          <FeedbackSection initial={feedback} />
        </Section>

        {/* 6. User debug */}
        <Section title="User debug">
          <UserDebugSection />
        </Section>

        {/* 7. Audit log */}
        <Section title="Audit log">
          {audit.length === 0 ? (
            <Empty>No admin actions logged yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs text-muted-foreground">{dateFmt(a.createdAt)}</TableCell>
                    <TableCell style={mono}>{a.actorEmail}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs" style={mono}>
                      {a.targetType ? `${a.targetType}:${a.targetId?.slice(0, 8) ?? ""}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}
