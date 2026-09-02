"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SpinnerIcon } from "@/components/icons";
import { toastApiError } from "@/lib/error-helpers";
import { PLAN_LABELS } from "@outrival/shared";
import { api } from "@/lib/api";
import { battleCardSettingsQuery } from "@/lib/queries";
import { Switch } from "@/components/ui/switch";
import { SettingRowsSkeleton } from "@/components/dashboard/skeletons";

// OUT-193 — whether the nightly pass rewrites cards the feed has outdated.
//
// The toggle is writable on every plan and the value survives an upgrade, so this is
// not a paywall row and carries no lock badge. What changes with the plan is whether
// the pass acts on it: a free workspace gets one card a day, and spending it
// automatically would take the card the user meant to write themselves.
export function BattleCardRefreshCard() {
  const qc = useQueryClient();
  const q = useQuery(battleCardSettingsQuery());
  const [saving, setSaving] = useState(false);

  if (q.isLoading) return <SettingRowsSkeleton rows={1} />;
  if (!q.data) return null;

  const { autoRefresh, plan, planAllows } = q.data;

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      await api.updateBattleCardSettings(next);
      await qc.invalidateQueries({ queryKey: battleCardSettingsQuery().queryKey });
    } catch (e) {
      toastApiError(e, { title: "Couldn't save that" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 border-b border-border py-3">
        <div className="min-w-0">
          <label
            htmlFor="battle-card-auto-refresh"
            className="flex flex-wrap items-center gap-2 text-dense font-medium"
          >
            Refresh cards when the feed moves
            {saving && <SpinnerIcon className="size-3.5 animate-spin text-muted-foreground" />}
          </label>
          <p className="mt-1 max-w-[52ch] text-xs text-muted-foreground">
            Once a day, a card whose competitor has shipped new signals since it was
            written gets rewritten on them. Up to three cards a day, and never on a day
            you have already generated one yourself.
          </p>
        </div>
        <Switch
          id="battle-card-auto-refresh"
          checked={autoRefresh}
          disabled={saving}
          onCheckedChange={toggle}
        />
      </div>

      {!planAllows && (
        <p className="text-xs text-muted-foreground">
          The nightly pass runs from Starter up. On {PLAN_LABELS[plan]} your quota is one
          card a day, so refreshing automatically would spend it for you. The setting is
          kept and takes effect as soon as you upgrade.
        </p>
      )}
    </div>
  );
}
