"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { PageHeader, Section, Empty, mono, dateFmt } from "../_components/shell";
import { api } from "@/lib/api";
import type { AdminFeedbackRow, AdminFeedbackStatus } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export function FeedbackView({ initial }: { initial: AdminFeedbackRow[] }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<string>("all");
  const [shot, setShot] = useState<string | null>(null);
  const [loadingShot, setLoadingShot] = useState(false);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

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
      setShot(URL.createObjectURL(await res.blob()));
    } catch {
      toast.error("No screenshot available");
    } finally {
      setLoadingShot(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Feedback" subtitle="User reports — triage, screenshots, console errors." />

      <Section
        title={`Feedback (${visible.length})`}
        action={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">new</SelectItem>
              <SelectItem value="reviewed">reviewed</SelectItem>
              <SelectItem value="resolved">resolved</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        {visible.length === 0 ? (
          <Empty>No feedback.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((f) => (
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
          </div>
        )}
      </Section>

      <Dialog open={!!shot} onOpenChange={(o) => !o && setShot(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Feedback screenshot</DialogTitle>
          </DialogHeader>
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="feedback screenshot" className="max-h-[70vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
