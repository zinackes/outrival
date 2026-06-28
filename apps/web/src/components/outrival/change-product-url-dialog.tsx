"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Shared modal to point monitoring at a new product URL. Routes through
 * POST /my-product/site, which updates both the org (discovery reference) and
 * the self-competitor (the monitored entity), seeds any missing site monitors,
 * and re-scans immediately. The profile re-enriches asynchronously from the new
 * site — no full onboarding needed. Used from My Product and Settings.
 */
export function ChangeProductUrlDialog({
  open,
  onOpenChange,
  currentUrl,
  productId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl?: string | null;
  // patch-28 — scope to a given product's self-competitor; omitted → the primary.
  productId?: string;
  onSaved?: (url: string) => void | Promise<void>;
}) {
  const [url, setUrl] = useState(currentUrl ?? "");
  const [saving, setSaving] = useState(false);

  // Reset the field to the current URL each time the dialog (re)opens.
  useEffect(() => {
    if (open) setUrl(currentUrl ?? "");
  }, [open, currentUrl]);

  async function save() {
    const next = url.trim();
    if (!next || next === (currentUrl ?? "")) return;
    setSaving(true);
    try {
      await api.setMyProductSite(next, productId);
      toast.success("Product URL updated", {
        description: "Your site will be re-scanned and the profile refreshed shortly.",
      });
      onOpenChange(false);
      await onSaved?.(next);
    } catch (e) {
      toastApiError(e, { title: "Couldn't update product URL" });
    } finally {
      setSaving(false);
    }
  }

  const next = url.trim();
  const canSave = next.length > 0 && next !== (currentUrl ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change product URL</DialogTitle>
          <DialogDescription>
            Update the site we monitor for your product. We&apos;ll re-scan it and refresh your
            profile automatically — your competitors and tracked data are kept.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor="change-product-url">Product URL</Label>
          <Input
            id="change-product-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourproduct.com"
            autoFocus
          />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !canSave}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
