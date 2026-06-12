"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PageHeader,
  Section,
  Empty,
  StatusPill,
  mono,
  durationFmt,
  centsFmt,
  relativeFmt,
  dateFmt,
} from "../_components/shell";
import { api } from "@/lib/api";
import type { AdminJobRun, AdminJobDetail } from "@/lib/api";

const STATUSES = [
  "COMPLETED",
  "FAILED",
  "CRASHED",
  "EXECUTING",
  "QUEUED",
  "WAITING",
  "CANCELED",
  "TIMED_OUT",
];

export function JobsView({
  initialRuns,
  initialCursor,
  unavailable,
}: {
  initialRuns: AdminJobRun[];
  initialCursor: string | null;
  unavailable: boolean;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [cursor, setCursor] = useState(initialCursor);
  const [status, setStatus] = useState<string>("all");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AdminJobDetail | null>(null);

  async function reload(opts?: { append?: boolean }) {
    setBusy(true);
    try {
      const res = await api.adminListJobs({
        status: status === "all" ? undefined : status,
        task: task.trim() || undefined,
        after: opts?.append ? cursor ?? undefined : undefined,
      });
      if (res.error) toast.error("Trigger.dev unavailable");
      setRuns((prev) => (opts?.append ? [...prev, ...res.runs] : res.runs));
      setCursor(res.nextCursor);
    } catch {
      toast.error("Could not load runs");
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    try {
      const res = await api.adminGetJob(id);
      setDetail(res.run);
    } catch {
      toast.error("Could not load run");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Jobs" subtitle="Trigger.dev runs — every task, live from the run history." />

      <Section
        title="Runs"
        info="Live Trigger.dev run history — every background task with its status, duration and timestamps. Filter by status and refresh to poll the latest runs."
        action={
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => reload()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="task identifier (e.g. scrape-monitor)"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload()}
            className="h-8 w-64 text-xs"
          />
          <Button size="sm" className="h-8" disabled={busy} onClick={() => reload()}>
            Apply
          </Button>
        </div>

        {unavailable && runs.length === 0 ? (
          <Empty>Trigger.dev run history unavailable (check TRIGGER_SECRET_KEY).</Empty>
        ) : runs.length === 0 ? (
          <Empty>No runs match.</Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell style={mono}>
                      {r.taskIdentifier}
                      {r.isTest ? <span className="ml-1 text-meta text-muted-foreground">(test)</span> : null}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={r.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground" title={dateFmt(r.startedAt ?? r.createdAt)}>
                      {relativeFmt(r.startedAt ?? r.createdAt)}
                    </TableCell>
                    <TableCell className="text-right" style={mono}>
                      {durationFmt(r.durationMs)}
                    </TableCell>
                    <TableCell className="text-right" style={mono}>
                      {centsFmt(r.costInCents)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(r.id)}>
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {cursor ? (
              <div className="mt-3 flex justify-center">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => reload({ append: true })}>
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={mono}>
              {detail?.taskIdentifier}
              {detail ? <StatusPill status={detail.status} /> : null}
            </DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Run ID</span>
                  <p style={mono}>{detail.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Attempts</span>
                  <p style={mono}>{detail.attemptCount ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Started</span>
                  <p style={mono}>{dateFmt(detail.startedAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration</span>
                  <p style={mono}>{durationFmt(detail.durationMs)}</p>
                </div>
              </div>
              {detail.error ? (
                <div>
                  <span className="text-xs text-muted-foreground">Error</span>
                  <pre
                    className="mt-1 max-h-40 overflow-auto rounded p-2 text-meta"
                    style={{ ...mono, background: "var(--surface-2)", color: "var(--critical)" }}
                  >
                    {detail.error}
                  </pre>
                </div>
              ) : null}
              {detail.payload != null ? (
                <div>
                  <span className="text-xs text-muted-foreground">Payload</span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-secondary p-2 text-meta" style={mono}>
                    {JSON.stringify(detail.payload, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
