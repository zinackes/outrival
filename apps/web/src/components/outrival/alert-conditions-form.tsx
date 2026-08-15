"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, PlusIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { api, ApiError, type AlertCondition } from "@/lib/api";
import { alertConditionsQuery } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/dashboard/settings-page";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SettingCardRowsSkeleton } from "@/components/dashboard/skeletons";
import { SettingsError } from "@/components/outrival/list-error";

// Alert conditions (OUT-192). The user writes what matters to them in one sentence and
// every new signal is checked against it; a match flags the signal as important and the
// sentence itself becomes the reason shown on the row. No builder, no operators, no
// field picker: the whole point of the feature is that a sentence is the input.

// Real conditions, not lorem — the examples ARE the documentation for what the matcher
// can do, and a placeholder like "Enter a condition" teaches nothing.
const EXAMPLES = [
  "Price drops below $50 on any plan",
  "Adds SSO or SAML to a self-serve tier",
  "Hires a VP of Sales in EMEA",
];

function lastFired(condition: AlertCondition): string {
  if (condition.matchCount === 0) return "Not fired yet";
  const when = condition.lastMatchedAt
    ? new Date(condition.lastMatchedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;
  const times = `${condition.matchCount} ${condition.matchCount === 1 ? "signal" : "signals"}`;
  return when ? `${times} · last ${when}` : times;
}

export function AlertConditionsForm() {
  const queryClient = useQueryClient();
  const listQ = useQuery(alertConditionsQuery());
  const conditions = listQ.data?.conditions ?? null;
  const max = listQ.data?.max ?? 25;

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: alertConditionsQuery().queryKey });
  }

  async function add() {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.createAlertCondition(text);
      setDraft("");
      await refresh();
    } catch (e) {
      setAddError(
        e instanceof ApiError && e.code === "alert_conditions_limit"
          ? `You can keep ${max} conditions. Delete one first.`
          : "Couldn't save that condition. Try again.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function toggle(condition: AlertCondition) {
    setBusyId(condition.id);
    try {
      await api.updateAlertCondition(condition.id, { isActive: !condition.isActive });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.deleteAlertCondition(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection
      title="Alert conditions"
      description="Write what you want flagged, in your own words. Every new signal is checked against these, and a match is marked important with your sentence as the reason."
    >
      <div className="flex flex-wrap items-start gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setAddError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          maxLength={200}
          placeholder={EXAMPLES[0]}
          aria-label="New alert condition"
          className="h-9 min-w-[240px] flex-1 text-dense"
        />
        <Button size="sm" onClick={() => void add()} disabled={adding || !draft.trim()}>
          {adding ? <SpinnerIcon size={16} className="animate-spin" /> : <PlusIcon size={16} />}
          Add
        </Button>
        {addError && <p className="w-full text-xs text-critical">{addError}</p>}
      </div>

      {/* One click to try the feature. Writing the first rule from a blank field is
          where a feature like this dies, and the examples double as the spec. */}
      {(conditions?.length ?? 0) === 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <Button
              key={example}
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-meta"
              onClick={() => setDraft(example)}
            >
              {example}
            </Button>
          ))}
        </div>
      )}

      {listQ.isError ? (
        <SettingsError
          title="Conditions didn't load"
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
        />
      ) : listQ.isPending ? (
        <SettingCardRowsSkeleton rows={1} />
      ) : conditions && conditions.length > 0 ? (
        <Card className="divide-y divide-border overflow-hidden">
          {conditions.map((condition) => (
            <div key={condition.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div
                  className={`text-dense ${condition.isActive ? "" : "text-muted-foreground line-through"}`}
                >
                  {condition.condition}
                </div>
                <div className="text-meta text-muted-foreground tabular-nums">
                  {lastFired(condition)}
                </div>
              </div>
              <Switch
                checked={condition.isActive}
                disabled={busyId === condition.id}
                onCheckedChange={() => void toggle(condition)}
                aria-label={
                  condition.isActive ? "Pause this condition" : "Resume this condition"
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Delete condition"
                disabled={busyId === condition.id}
                onClick={() => void remove(condition.id)}
                className="text-muted-foreground hover:text-critical"
              >
                <TrashIcon size={16} />
              </Button>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState
          icon={BellIcon}
          title="No conditions yet"
          description="Without one, signals are flagged from their severity and relevance alone. A condition tells us what matters to you specifically."
        />
      )}
    </SettingsSection>
  );
}
