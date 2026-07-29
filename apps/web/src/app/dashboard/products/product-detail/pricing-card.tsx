"use client";

import { useState } from "react";
import {
  CheckIcon,
  SpinnerIcon,
  PencilIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import type { MyProduct, MyProductPatch, MyProductPricingTier } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PRICING_LABELS: Record<string, string> = {
  public: "Public",
  public_partial: "Partially public",
  gated_demo: "Demo-gated",
  gated_signup: "Signup-gated",
  dynamic: "Dynamic / quote-based",
  unknown: "Unknown",
};

const PRICING_STATUS_OPTIONS = Object.entries(PRICING_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Editable pricing block: hand-entered tiers (sticky vs scrapes) plus status,
 * promo flag and note. Tiers are the only pricing surface with no source outside
 * scraped history, so without it the user can still maintain them by hand. */
export function PricingCard({
  pricing,
  onSave,
}: {
  pricing: MyProduct["pricing"];
  onSave: (p: NonNullable<MyProductPatch["pricing"]>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tiers, setTiers] = useState<MyProductPricingTier[]>([]);
  const [status, setStatus] = useState("unknown");
  const [promotional, setPromotional] = useState(false);
  const [note, setNote] = useState("");

  function startEdit() {
    setTiers(pricing.tiers.map((t) => ({ ...t })));
    setStatus(pricing.status ?? "unknown");
    setPromotional(pricing.promotional);
    setNote(pricing.note ?? "");
    setEditing(true);
  }

  function setTier(i: number, patch: Partial<MyProductPricingTier>) {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        status,
        promotional,
        note: note.trim() || null,
        tiers: tiers
          .filter((t) => t.plan_name.trim())
          .map((t) => ({
            plan_name: t.plan_name.trim(),
            price: Number.isFinite(t.price) ? t.price : 0,
            currency: (t.currency || "USD").trim(),
            billing_period: (t.billing_period || "monthly").trim(),
          })),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="bg-gradient-card-strong p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground">
            Pricing
          </h3>
          {pricing.tiers.length > 0 && (
            <span className="text-meta text-[var(--muted-2)] inline-flex items-center gap-1">
              {pricing.tiersManual ? (
                <>
                  edited by you
                  {pricing.tiersEditedAt
                    ? ` ${formatDistanceToNow(new Date(pricing.tiersEditedAt), { addSuffix: true })}`
                    : ""}
                </>
              ) : (
                <>
                  <SparkleIcon className="size-3.5" /> detected auto
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && pricing.promotional && (
            <Badge variant="secondary" className="text-meta">
              promo
            </Badge>
          )}
          {!editing && (
            <Badge variant="outline" className="text-meta">
              {PRICING_LABELS[pricing.status ?? "unknown"] ?? "Unknown"}
            </Badge>
          )}
          {!editing && (
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <PencilIcon className="size-4" /> Edit
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={t.plan_name}
                  onChange={(e) => setTier(i, { plan_name: e.target.value })}
                  placeholder="Plan name"
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  value={t.price ?? 0}
                  onChange={(e) =>
                    setTier(i, { price: e.target.value === "" ? 0 : Number(e.target.value) })
                  }
                  placeholder="0"
                  className="w-24"
                />
                <Input
                  value={t.currency}
                  onChange={(e) => setTier(i, { currency: e.target.value })}
                  placeholder="USD"
                  className="w-20"
                />
                <Input
                  value={t.billing_period}
                  onChange={(e) => setTier(i, { billing_period: e.target.value })}
                  placeholder="monthly"
                  className="w-28"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setTiers((ts) => ts.filter((_, idx) => idx !== i))}
                  aria-label="Remove tier"
                >
                  <TrashIcon className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                setTiers((ts) => [
                  ...ts,
                  { plan_name: "", price: 0, currency: "USD", billing_period: "monthly" },
                ])
              }
            >
              <PlusIcon className="size-4" /> Add tier
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 items-center">
            <div className="text-dense text-muted-foreground">Pricing model</div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="text-dense text-muted-foreground">Note</div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context (e.g. enterprise only on request)"
            />

            <div className="text-dense text-muted-foreground">Promotional</div>
            <label className="inline-flex items-center gap-2 text-dense">
              <Checkbox
                checked={promotional}
                onCheckedChange={(v) => setPromotional(v === true)}
              />
              Pricing currently shows a promotion
            </label>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <SpinnerIcon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              <XIcon className="size-4" /> Cancel
            </Button>
          </div>
        </div>
      ) : pricing.tiers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {pricing.tiers.map((t, i) => (
            <div key={`${t.plan_name}-${i}`} className="flex items-center justify-between text-sm">
              <span>{t.plan_name}</span>
              <span className="tabular-nums text-foreground">
                {t.price === null ? (
                  "Custom"
                ) : (
                  <>
                    {t.price === 0 ? "Free" : `${t.price} ${t.currency}`}
                    <span className="text-[var(--muted-2)]">/{t.billing_period}</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-dense text-[var(--muted-2)]">
          No pricing tiers yet.{" "}
          <button type="button" className="underline" onClick={startEdit}>
            Add them by hand
          </button>{" "}
          or re-scan your pricing page.
        </div>
      )}

      {!editing && (pricing.observedRegion || pricing.note) && (
        <div className="text-meta text-[var(--muted-2)] mt-2">
          {pricing.observedRegion ? `Seen from ${pricing.observedRegion}` : ""}
          {pricing.note ? ` · ${pricing.note}` : ""}
        </div>
      )}
    </Card>
  );
}
