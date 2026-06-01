"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Pencil, RefreshCw, Tag } from "lucide-react";
import { api, type Competitor, type PricingStatus } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_META: Record<PricingStatus, { label: string; blurb: string }> = {
  public: { label: "Public pricing", blurb: "Prices are fully visible." },
  public_partial: {
    label: "Partially public",
    blurb: "Some tiers are public; the top tier is sales-gated.",
  },
  gated_demo: { label: "Demo-gated", blurb: "No public prices — sales/demo required." },
  gated_signup: { label: "Signup-gated", blurb: "Pricing is hidden behind an account." },
  dynamic: { label: "Usage-based", blurb: "Interactive calculator / usage-based pricing." },
  unknown: { label: "Unknown", blurb: "Automatic detection was inconclusive." },
};

const STATUS_OPTIONS: PricingStatus[] = [
  "public",
  "public_partial",
  "gated_demo",
  "gated_signup",
  "dynamic",
  "unknown",
];

export function CompetitorPricingCard({
  competitor,
  onUpdated,
}: {
  competitor: Competitor;
  onUpdated: () => void;
}) {
  const status: PricingStatus = competitor.pricingStatus ?? "unknown";
  const meta = STATUS_META[status];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function redetect() {
    setBusy(true);
    try {
      const res = await api.redetectCompetitorPricing(competitor.id);
      toast.success(
        res.rescraped ? "Re-detecting pricing…" : "Switched back to automatic detection",
      );
      onUpdated();
    } catch (e) {
      toast.error(`Could not re-detect: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Tag className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{meta.label}</span>
            {competitor.pricingPromotional && (
              <Badge variant="secondary" className="text-[10px]">
                Promotional
              </Badge>
            )}
            {competitor.pricingManualOverride && (
              <Badge variant="outline" className="text-[10px]">
                Edited by you
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{competitor.pricingNote ?? meta.blurb}</p>
          {competitor.pricingObservedRegion && (
            <p className="text-[11px] text-muted-foreground">
              Observed from region {competitor.pricingObservedRegion}
            </p>
          )}
          {status === "gated_demo" && competitor.pricingDemoUrl && (
            <a
              href={competitor.pricingDemoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <ExternalLink className="size-3" /> Demo / contact page
            </a>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {competitor.pricingManualOverride ? (
            <Button variant="ghost" size="sm" onClick={redetect} disabled={busy}>
              <RefreshCw className="size-3.5" /> Re-detect
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> {status === "unknown" ? "Fill in" : "Edit"}
            </Button>
          )}
        </div>
      </div>

      <PricingOverrideDialog
        competitor={competitor}
        open={editing}
        onOpenChange={setEditing}
        onSaved={onUpdated}
      />
    </Card>
  );
}

function PricingOverrideDialog({
  competitor,
  open,
  onOpenChange,
  onSaved,
}: {
  competitor: Competitor;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<PricingStatus>(competitor.pricingStatus ?? "unknown");
  const [note, setNote] = useState(competitor.pricingNote ?? "");
  const [demoUrl, setDemoUrl] = useState(competitor.pricingDemoUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateCompetitorPricing(competitor.id, {
        status,
        note: note.trim() || null,
        demoUrl: demoUrl.trim() || null,
      });
      toast.success("Pricing saved");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set pricing manually</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricing-status">Status</Label>
            <select
              id="pricing-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PricingStatus)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricing-note">Note</Label>
            <Textarea
              id="pricing-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Enterprise only, contact sales"
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricing-demo">Demo / contact URL</Label>
            <Input
              id="pricing-demo"
              value={demoUrl}
              onChange={(e) => setDemoUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
