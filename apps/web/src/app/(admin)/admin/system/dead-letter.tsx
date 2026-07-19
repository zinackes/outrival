"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Section, Empty, mono, relativeFmt, dateFmt } from "../_components/shell";
import { api } from "@/lib/api";
import type { AdminDeadLetterRow, AdminQueueHealth } from "@/lib/api";

// Jobs that exhausted every retry — pg-boss's dead-letter queue. An empty table is
// the healthy state; a non-empty one is the "a job gave up silently" signal that a
// vanished Trigger.dev run used to hide.
export function DeadLetterSection({ deadLetter }: { deadLetter: AdminQueueHealth["deadLetter"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState<AdminDeadLetterRow | null>(null);

  async function redrive() {
    setBusy(true);
    try {
      const res = await api.adminRedriveDlq();
      toast.success(res.moved > 0 ? `Redrove ${res.moved} job${res.moved === 1 ? "" : "s"}` : "Nothing to redrive");
      router.refresh();
    } catch {
      toast.error("Could not redrive the dead-letter queue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Dead-letter queue"
      note={deadLetter.count > 0 ? `${deadLetter.count}` : undefined}
      info="Jobs that exhausted every retry without a human noticing. Empty is healthy. Redrive puts every job here back on its original queue for one more attempt."
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !deadLetter.available || deadLetter.count === 0}
          onClick={redrive}
        >
          Redrive
        </Button>
      }
    >
      {!deadLetter.available ? (
        <Empty>Dead-letter queue unavailable.</Empty>
      ) : deadLetter.rows.length === 0 ? (
        <Empty>Empty — no job has exhausted its retries.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source queue</TableHead>
              <TableHead>Landed</TableHead>
              <TableHead className="text-right">Retries</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deadLetter.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell style={mono}>{r.sourceQueue ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground" title={dateFmt(r.createdAt)}>
                  {relativeFmt(r.createdAt)}
                </TableCell>
                <TableCell className="text-right" style={mono}>
                  {r.retryCount}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setInspecting(r)}>
                    Payload
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!inspecting} onOpenChange={(o) => !o && setInspecting(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle style={mono}>{inspecting?.sourceQueue ?? "Dead-letter payload"}</DialogTitle>
          </DialogHeader>
          {inspecting ? (
            <pre className="mt-1 max-h-96 overflow-auto rounded bg-secondary p-2 text-meta" style={mono}>
              {JSON.stringify(inspecting.payload, null, 2)}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
