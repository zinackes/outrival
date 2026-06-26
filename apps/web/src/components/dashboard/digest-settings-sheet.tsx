"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type NotificationSettings } from "@/lib/api";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

export function DigestSettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .getNotificationSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateNotificationSettings({
        digestEmail: settings.digestEmail || null,
        digestEnabled: settings.digestEnabled,
      });
      toast.success("Digest settings saved");
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
            Digest settings
          </SheetTitle>
          <SheetDescription className="text-dense">
            Sent every Monday at 09:00 UTC. Customize destination and
            activation.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!settings && !error && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-2.5 w-56" />
              </div>
              <Skeleton className="h-9 w-56" />
            </div>
          )}
          {error && !settings && (
            <p className="text-sm text-critical">Error: {error}</p>
          )}
          {settings && (
            <form
              id="digest-settings-form"
              onSubmit={handleSubmit}
              className="flex flex-col gap-5"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="digest-email">Recipient email</Label>
                <Input
                  id="digest-email"
                  type="email"
                  value={settings.digestEmail ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, digestEmail: e.target.value })
                  }
                  placeholder="you@company.com"
                />
                <p className="text-meta text-muted-foreground">
                  Address that will receive the weekly digest.
                </p>
              </div>

              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <Checkbox
                  checked={settings.digestEnabled}
                  onCheckedChange={(c) =>
                    setSettings({ ...settings, digestEnabled: c === true })
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">
                    Enable weekly digest
                  </span>
                  <span className="block text-meta text-muted-foreground mt-0.5">
                    Disabling stops sending but keeps history.
                  </span>
                </span>
              </label>

              <div className="rounded-md border border-border bg-card px-3.5 py-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Coming soon
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside marker:text-muted-foreground/40">
                  <li>Pick send day and time</li>
                  <li>Filter by severity or category</li>
                  <li>Multiple recipients</li>
                </ul>
              </div>

              {error && (
                <p className="text-xs text-critical">Error: {error}</p>
              )}
            </form>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/settings" className="text-muted-foreground">
              All settings
              <ExternalLink size={11} />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              form="digest-settings-form"
              size="sm"
              disabled={saving || !settings}
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
