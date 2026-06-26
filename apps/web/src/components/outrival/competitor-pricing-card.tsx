"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ExternalLink, Pencil, RefreshCw, Sparkles, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type Competitor, type PricingStatus } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  hasCapturedTiers = false,
  isCapturing = false,
  summary,
  summaryUpdatedAt,
}: {
  competitor: Competitor;
  onUpdated: () => void;
  // Whether any priced tiers have actually been extracted (pricing history).
  // The detected status can be "public" from price tokens alone, before the tiers
  // are parsed — so we don't claim prices are visible when none were captured.
  hasCapturedTiers?: boolean;
  // A pricing scrape is in flight — show a "capturing" hint instead of an empty state.
  isCapturing?: boolean;
  // The pricing source's AI summary, folded into this header as a "Summary"
  // toggle so the status and "what we found" share one row instead of two bands.
  summary?: string | null;
  summaryUpdatedAt?: string | null;
}) {
  const status: PricingStatus = competitor.pricingStatus ?? "unknown";
  const meta = STATUS_META[status];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // "public"/"public_partial" promise visible prices; if none were captured yet,
  // override the reassuring blurb with an honest one instead of the misleading
  // "Prices are fully visible." (the original bug: status set, zero tiers shown).
  const expectsTiers = status === "public" || status === "public_partial";
  const tiersMissing = expectsTiers && !hasCapturedTiers;
  // Drop the blurb for plain "public" pricing — "Prices are fully visible" is
  // self-evident from the label, so the detected case collapses to one line. A
  // manual note, the missing-tiers warning, or a non-obvious status still show.
  const blurb = tiersMissing
    ? "Tiers not captured yet — they'll appear after the next successful pricing scan."
    : (competitor.pricingNote ?? (status === "public" ? null : meta.blurb));

  async function redetect() {
    setBusy(true);
    try {
      const res = await api.redetectCompetitorPricing(competitor.id);
      toast.success(
        res.rescraped ? "Re-detecting pricing…" : "Switched back to automatic detection",
      );
      onUpdated();
    } catch (e) {
      toastApiError(e, { title: "Couldn't re-detect pricing" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Tag className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-content font-semibold tracking-tight leading-tight">{meta.label}</span>
          {competitor.pricingObservedRegion && (
            <span className="shrink-0 text-xs text-muted-foreground">
              · {competitor.pricingObservedRegion}
            </span>
          )}
          {competitor.pricingPromotional && (
            <Badge variant="secondary" className="text-meta">
              Promotional
            </Badge>
          )}
          {competitor.pricingManualOverride && (
            <Badge variant="outline" className="text-meta">
              Edited by you
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {summary && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSummaryOpen((v) => !v)}
              aria-expanded={summaryOpen}
            >
              <Sparkles className="size-3.5" /> Summary
              <ChevronDown
                className={cn("size-3.5 transition-transform", summaryOpen && "rotate-180")}
              />
            </Button>
          )}
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

      {summary && summaryOpen && (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <p className="text-content leading-relaxed text-foreground/90">{summary}</p>
          {summaryUpdatedAt && (
            <p className="text-xs text-muted-foreground">
              updated {formatDistanceToNow(new Date(summaryUpdatedAt), { addSuffix: true })}
            </p>
          )}
        </div>
      )}

      {blurb && <p className="text-dense text-muted-foreground">{blurb}</p>}
      {isCapturing && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3 animate-spin" /> Capturing pricing…
        </p>
      )}
      {status === "gated_demo" && competitor.pricingDemoUrl && (
        <a
          href={competitor.pricingDemoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-dense text-primary hover:underline"
        >
          <ExternalLink className="size-3" /> Demo / contact page
        </a>
      )}

      <PricingOverrideDialog
        competitor={competitor}
        open={editing}
        onOpenChange={setEditing}
        onSaved={onUpdated}
      />
    </div>
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

  // Pre-fill the form from the latest detected/saved values each time it opens
  // (the dialog stays mounted, so useState initializers alone would go stale).
  useEffect(() => {
    if (!open) return;
    setStatus(competitor.pricingStatus ?? "unknown");
    setNote(competitor.pricingNote ?? "");
    setDemoUrl(competitor.pricingDemoUrl ?? "");
  }, [open, competitor.pricingStatus, competitor.pricingNote, competitor.pricingDemoUrl]);

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
      toastApiError(e, { title: "Couldn't save pricing" });
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
            <Select value={status} onValueChange={(v) => setStatus(v as PricingStatus)}>
              <SelectTrigger id="pricing-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
