"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Server-side export (GDPR portability): one org-scoped endpoint assembles the
// full dataset — competitors, monitors, signals, digests, products, candidates,
// battle cards, jobs, reviews — instead of stitching a partial set from list
// endpoints client-side.
export function DataSettings() {
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true);
    try {
      const payload = await api.exportData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outrival-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready");
    } catch {
      toast.error("Could not export your data");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Data</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Export or import your workspace data.
        </p>
      </header>

      <Card className="flex items-start gap-4 px-5 py-4">
        <div className="flex-1">
          <div className="text-dense font-medium">Export</div>
          <div className="text-dense text-muted-foreground mt-1">
            Download everything in your workspace — competitors, signals, digests,
            products, battle cards and more — as JSON.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportData} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Export
        </Button>
      </Card>

      <Card className="flex items-start gap-4 px-5 py-4 opacity-70">
        <div className="flex-1">
          <div className="text-dense font-medium">Import</div>
          <div className="text-dense text-muted-foreground mt-1">
            Import a list of competitors from CSV.
          </div>
        </div>
        <Button variant="outline" size="sm" disabled>
          Coming soon
        </Button>
      </Card>
    </section>
  );
}
