"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type StructuralChangeRow } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  pivot: "appears to have pivoted",
  site_dead: "appears to be down",
  acquired: "may have been acquired",
  category_shift: "no longer matches its category",
};

// Proactive banner for structural changes awaiting a decision (patch-23). The
// user must resolve each one explicitly — we never auto-resolve.
export function StructuralChangeBanner() {
  const queryClient = useQueryClient();
  const changesQ = useQuery({
    queryKey: ["structuralChanges", "detected"],
    queryFn: () => api.getStructuralChanges("detected").then((r) => r.changes),
  });
  const changes = changesQ.data ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  // Optimistic write-through for the resolve mutation below.
  function setChanges(updater: (prev: StructuralChangeRow[]) => StructuralChangeRow[]) {
    queryClient.setQueryData<StructuralChangeRow[]>(
      ["structuralChanges", "detected"],
      (prev) => updater(prev ?? []),
    );
  }

  if (changes.length === 0) return null;

  async function resolve(change: StructuralChangeRow, resolution: string) {
    setBusyId(change.id);
    try {
      await api.resolveStructuralChange(change.id, resolution);
      setChanges((prev) => prev.filter((c) => c.id !== change.id));
    } catch {
      toast.error("Couldn't update this. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {changes.map((change) => {
        const summary =
          typeof change.evidence?.currentSummary === "string"
            ? (change.evidence.currentSummary as string)
            : "";
        const name = change.competitorName ?? "A competitor";
        return (
          <div
            key={change.id}
            className="rounded-lg border border-critical/40 bg-critical/5 p-4"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {name} {TYPE_LABEL[change.type] ?? "changed structurally"}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Our analysis suggests its site no longer matches your monitoring profile.
                  {summary ? ` ${summary}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => resolve(change, "confirmed_paused")}
                    disabled={busyId === change.id}
                  >
                    Correct — pause monitoring
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resolve(change, "false_positive")}
                    disabled={busyId === change.id}
                  >
                    False positive — keep watching
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/dashboard/competitors/${change.competitorId}`}>Open competitor</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
