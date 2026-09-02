"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { DownloadSimpleIcon, SpinnerIcon } from "@/components/icons";
import { toast } from "@/lib/toast";
import { toastApiError } from "@/lib/error-helpers";
import { PLAN_LIMITS } from "@outrival/shared";
import { api } from "@/lib/api";
import { planQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import {
  SettingRow,
  SettingsSection,
} from "@/components/dashboard/settings-page";

function retentionLabel(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365);
    return years === 1 ? "1 year" : `${years} years`;
  }
  return `${days} days`;
}

// Server-side export (GDPR portability): one org-scoped endpoint assembles the
// full dataset — competitors, monitors, signals, digests, products, candidates,
// battle cards, jobs, reviews — instead of stitching a partial set from list
// endpoints client-side.
export function DataSettings() {
  const [busy, setBusy] = useState(false);
  // Shares the ["plan"] cache with Integrations / Notifications / Billing.
  const planQ = useQuery(planQuery());
  const plan = planQ.data ?? null;

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
    } catch (e) {
      toastApiError(e, { title: "Could not export your data" });
    } finally {
      setBusy(false);
    }
  }

  // Rows, not one Card per line: export and import are two decisions in the same
  // list, and a card each made the shorter one (Import, disabled) look like its
  // own feature area rather than the second half of a pair.
  return (
    <>
      <SettingsSection title="Export & import">
        <div className="flex flex-col">
          <SettingRow
            label="Export"
            hint="Download everything in your workspace (competitors, signals, digests, products, battle cards and more) as JSON."
            control={
              <Button variant="outline" size="sm" onClick={exportData} disabled={busy}>
                {busy ? (
                  <SpinnerIcon size={16} className="animate-spin" />
                ) : (
                  <DownloadSimpleIcon size={16} />
                )}
                Export
              </Button>
            }
          />
          <SettingRow
            label="Import"
            hint="Import a list of competitors from CSV."
            control={
              <Button variant="outline" size="sm" disabled>
                Coming soon
              </Button>
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Retention & privacy">
        <div className="flex flex-col gap-2">
          <p className="max-w-[64ch] text-dense text-muted-foreground">
            {plan
              ? `On the ${plan} plan, competitor history and signals are kept for ${retentionLabel(
                  PLAN_LIMITS[plan].historyRetentionDays,
                )}; older records are purged automatically.`
              : "Competitor history and signals are retained for a window that depends on your plan; older records are purged automatically."}
          </p>
          <p className="max-w-[64ch] text-dense text-muted-foreground">
            See how we handle your data in our{" "}
            <Link href="/privacy" target="_blank" className="text-link underline underline-offset-2">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" target="_blank" className="text-link underline underline-offset-2">
              terms
            </Link>
            .
          </p>
        </div>
      </SettingsSection>
    </>
  );
}
