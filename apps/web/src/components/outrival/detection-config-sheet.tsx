"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DETECTION_OVERLAP_PRESETS } from "@outrival/shared";
import { api, type DetectionConfig } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function DetectionConfigSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [config, setConfig] = useState<DetectionConfig | null>(null);
  const [excludedText, setExcludedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .getDetectionConfig()
      .then(({ config }) => {
        setConfig(config);
        setExcludedText(config.excludedDomains.join("\n"));
      })
      .catch((e) => setError(String(e)));
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const excludedDomains = excludedText
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean);
      const { config: next } = await api.updateDetectionConfig({
        ...config,
        excludedDomains,
      });
      setConfig(next);
      setExcludedText(next.excludedDomains.join("\n"));
      onSaved?.();
      toast.success("Detection settings saved");
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-0 flex flex-col sm:max-w-md">
        <SheetHeader className="px-5 py-4 border-b border-border">
          <SheetTitle className="tracking-tight text-content">
            Detection settings
          </SheetTitle>
          <SheetDescription className="text-dense">
            Tune how Outrival finds new competitors via Exa.ai.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!config && !error && (
            <div className="flex flex-col gap-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {error && !config && (
            <p className="text-sm text-critical">Error: {error}</p>
          )}
          {config && (
            <form
              id="detection-config-form"
              onSubmit={handleSubmit}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-1.5">
                <Label>Sensitivity</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={String(config.minOverlap)}
                  onValueChange={(v) =>
                    v && setConfig({ ...config, minOverlap: Number(v) })
                  }
                >
                  <ToggleGroupItem value={String(DETECTION_OVERLAP_PRESETS.broad)}>
                    Broad
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value={String(DETECTION_OVERLAP_PRESETS.balanced)}
                  >
                    Balanced
                  </ToggleGroupItem>
                  <ToggleGroupItem value={String(DETECTION_OVERLAP_PRESETS.strict)}>
                    Strict
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-meta font-mono text-muted-foreground">
                  Minimum overlap to surface a candidate (
                  {config.minOverlap}/100). Stricter = fewer, closer matches.
                </p>
              </div>

              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <Checkbox
                  checked={config.autoDetect}
                  onCheckedChange={(c) =>
                    setConfig({ ...config, autoDetect: c === true })
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">Auto-detection</span>
                  <span className="block text-meta font-mono text-muted-foreground mt-0.5">
                    Run on a schedule. Manual Refresh always works.
                  </span>
                </span>
              </label>

              <div className="flex flex-col gap-1.5">
                <Label>Cadence</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  disabled={!config.autoDetect}
                  value={config.cadence}
                  onValueChange={(v) =>
                    (v === "weekly" || v === "monthly") &&
                    setConfig({ ...config, cadence: v })
                  }
                >
                  <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
                  <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="detection-keywords">Search focus</Label>
                <Input
                  id="detection-keywords"
                  value={config.keywords}
                  onChange={(e) =>
                    setConfig({ ...config, keywords: e.target.value })
                  }
                  placeholder="e.g. enterprise, EU, open source"
                  maxLength={200}
                />
                <p className="text-meta font-mono text-muted-foreground">
                  Extra terms added to the auto query. Leave empty for default.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="detection-excluded">Excluded domains</Label>
                <Textarea
                  id="detection-excluded"
                  value={excludedText}
                  onChange={(e) => setExcludedText(e.target.value)}
                  placeholder={"acme.com\npartner.io"}
                  rows={4}
                  className="font-mono text-xs"
                />
                <p className="text-meta font-mono text-muted-foreground">
                  One domain per line. Never surfaced (parent co, partners…).
                </p>
              </div>

              {error && <p className="text-xs text-critical">Error: {error}</p>}
            </form>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-3">
          <Button
            type="submit"
            form="detection-config-form"
            size="sm"
            disabled={saving || !config}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
