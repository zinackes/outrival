"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea";
  placeholder?: string;
}

// Fields tailored to the source type — what a user can realistically read off the
// page themselves. Everything stored verbatim as the manual snapshot's `data`.
const FIELDS_BY_SOURCE: Record<string, FieldDef[]> = {
  pricing: [
    { key: "status", label: "Pricing status", type: "text", placeholder: "public / gated / contact sales" },
    { key: "tiers", label: "Tiers (one per line: name — price)", type: "textarea", placeholder: "Starter — $19/mo\nPro — $49/mo" },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
  jobs: [
    { key: "openRoles", label: "Number of open roles", type: "text", placeholder: "12" },
    { key: "titles", label: "Role titles (one per line)", type: "textarea" },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
  g2_reviews: [
    { key: "rating", label: "Average rating", type: "text", placeholder: "4.5" },
    { key: "reviewCount", label: "Number of reviews", type: "text", placeholder: "320" },
    { key: "quotes", label: "Representative quotes (one per line)", type: "textarea" },
  ],
  capterra_reviews: [
    { key: "rating", label: "Average rating", type: "text", placeholder: "4.5" },
    { key: "reviewCount", label: "Number of reviews", type: "text", placeholder: "320" },
    { key: "quotes", label: "Representative quotes (one per line)", type: "textarea" },
  ],
};

const DEFAULT_FIELDS: FieldDef[] = [
  { key: "summary", label: "Key information", type: "textarea", placeholder: "What you saw on the page that matters." },
];

interface Props {
  monitorId: string;
  sourceType: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}

export function ManualDataEntry({ monitorId, sourceType, open, onOpenChange, onSubmitted }: Props) {
  const fields = FIELDS_BY_SOURCE[sourceType] ?? DEFAULT_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key]?.trim();
      if (v) data[f.key] = v;
    }
    if (Object.keys(data).length === 0) {
      toast.error("Add at least one piece of information before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.submitManualSnapshot(monitorId, {
        data,
        ...(evidenceUrl.trim() ? { evidenceUrl: evidenceUrl.trim() } : {}),
      });
      toast.success("Saved. This data is tagged as entered manually.");
      onOpenChange(false);
      onSubmitted?.();
    } catch {
      toast.error("Couldn't save your entry. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enter information manually</DialogTitle>
          <DialogDescription>
            We couldn&apos;t scrape this source. Add what you can see so it stays tracked — it will
            be clearly marked as entered manually.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`mde-${f.key}`}>{f.label}</Label>
              {f.type === "textarea" ? (
                <Textarea
                  id={`mde-${f.key}`}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`mde-${f.key}`}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mde-evidence">Source (screenshot or link, optional)</Label>
            <Input
              id="mde-evidence"
              placeholder="https://…"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
